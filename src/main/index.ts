import { app, shell, BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { join } from 'path'
import { randomBytes, createHash } from 'node:crypto'
import { tokenStore } from './tokenStore'
import type { T3KTokens, BeginSelectConfig, SelectResult, ViewBounds } from '../shared/types'

function loadApp(win: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Open http(s) links in the system browser; deny everything else. */
function openExternalHandler({ url }: { url: string }): { action: 'deny' } {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url)
  } catch {
    /* ignore malformed URLs */
  }
  return { action: 'deny' }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(openExternalHandler)

  loadApp(win)

  return win
}

// ─── Embedded OAuth (WebContentsView, main-owned) ────────────────────────────
// TONE3000 loads in a view with no preload (so window.t3k can't reach it).
// Main owns PKCE + redirect capture because the renderer can't listen to the
// view's navigation events.

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function buildAuthorizeUrl(cfg: BeginSelectConfig, codeChallenge: string, state: string): string {
  const url = new URL(`${cfg.apiDomain}/api/v1/oauth/authorize`)
  const p = url.searchParams
  p.set('client_id', cfg.publishableKey)
  p.set('redirect_uri', cfg.redirectUri)
  p.set('response_type', 'code')
  p.set('code_challenge', codeChallenge)
  p.set('code_challenge_method', 'S256')
  p.set('state', state)
  // Omit prompt for standard login; set it for select_tone.
  if (cfg.prompt) p.set('prompt', cfg.prompt)

  const o = cfg.options ?? {}
  if (o.gears) p.set('gears', o.gears)
  if (o.platform) p.set('platform', o.platform)
  if (o.menubar) p.set('menubar', 'true')
  if (o.architecture) p.set('architecture', o.architecture.toString())
  if (o.calibrated) p.set('calibrated', 'true')
  if (o.loginHint) p.set('login_hint', o.loginHint)

  return url.toString()
}

async function exchangeCode(
  cfg: { apiDomain: string; publishableKey: string; redirectUri: string },
  code: string,
  codeVerifier: string
): Promise<T3KTokens> {
  const res = await fetch(`${cfg.apiDomain}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.publishableKey,
    }),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? 'token_exchange_failed')
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
}

let activeView: WebContentsView | null = null
let pending: { codeVerifier: string; state: string; cfg: BeginSelectConfig } | null = null
let currentToneId: string | undefined
let cleanupInterceptor: (() => void) | null = null

/** Tear down the embedded view. Close is deferred — unsafe inside will-redirect. */
function destroyActiveView(win: BrowserWindow): void {
  cleanupInterceptor?.()
  cleanupInterceptor = null
  const view = activeView
  activeView = null
  if (!view) return
  if (!win.isDestroyed()) win.contentView.removeChildView(view)
  queueMicrotask(() => view.webContents.close())
}

/**
 * Start an OAuth flow in an embedded view at the given bounds.
 * Intercepts navigation to redirectUri (a sentinel — nothing serves it).
 */
function beginSelect(win: BrowserWindow, cfg: BeginSelectConfig, bounds: ViewBounds): void {
  destroyActiveView(win)
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  const state = base64url(randomBytes(16))
  pending = { codeVerifier, state, cfg }

  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  view.setBackgroundColor('#ffffff')
  activeView = view
  win.contentView.addChildView(view)
  view.setBounds(bounds)

  const wc = view.webContents
  wc.setWindowOpenHandler(openExternalHandler)

  const handleNavigation = (event: Electron.Event, url: string): void => {
    if (!url.startsWith(cfg.redirectUri)) return
    event.preventDefault()
    const params = new URL(url).searchParams
    void finishFlow(win, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
      error: params.get('error') ?? undefined,
      tone_id: params.get('tone_id') ?? undefined,
      canceled: params.get('canceled') === 'true',
    })
  }

  // Authorize returned 4xx with no redirect — finish instead of leaving an error page.
  const handleDidNavigate = (_e: Electron.Event, url: string, httpResponseCode: number): void => {
    if (url.startsWith(cfg.redirectUri)) return
    if (httpResponseCode >= 400) void finishFlow(win, { error: `authorize_failed_${httpResponseCode}` })
  }

  // Main-frame load failures don't fire did-navigate. Ignore ERR_ABORTED (-3)
  // from the redirect_uri navigation we cancel above.
  const handleFailLoad = (
    _e: Electron.Event,
    errorCode: number,
    _desc: string,
    validatedURL: string,
    isMainFrame: boolean
  ): void => {
    if (!isMainFrame || errorCode === -3 || validatedURL.startsWith(cfg.redirectUri)) return
    void finishFlow(win, { error: 'load_failed' })
  }

  const handleInput = (_e: Electron.Event, input: Electron.Input): void => {
    if (input.type === 'keyDown' && input.key === 'Escape') void finishFlow(win, { canceled: true })
  }

  cleanupInterceptor = (): void => {
    wc.removeListener('will-redirect', handleNavigation)
    wc.removeListener('will-navigate', handleNavigation)
    wc.removeListener('did-navigate', handleDidNavigate)
    wc.removeListener('did-fail-load', handleFailLoad)
    wc.removeListener('before-input-event', handleInput)
  }

  wc.on('will-redirect', handleNavigation)
  wc.on('will-navigate', handleNavigation)
  wc.on('did-navigate', handleDidNavigate)
  wc.on('did-fail-load', handleFailLoad)
  wc.on('before-input-event', handleInput)

  void wc.loadURL(buildAuthorizeUrl(cfg, codeChallenge, state))
}

interface CallbackParams {
  code?: string
  state?: string
  error?: string
  tone_id?: string
  canceled?: boolean
}

/** Exchange the code (if any), tear down the view, push the result. Settles once. */
async function finishFlow(win: BrowserWindow, params: CallbackParams): Promise<void> {
  if (!pending) return
  const { codeVerifier, state, cfg } = pending
  pending = null

  let status: SelectResult['status']
  let error: string | undefined
  if (params.canceled && !params.code) {
    status = 'canceled'
  } else if (params.error || params.state !== state || !params.code) {
    status = 'error'
    error = params.error
  } else {
    try {
      const tokens = await exchangeCode(cfg, params.code, codeVerifier)
      tokenStore.set(tokens)
      status = 'selected'
      if (params.tone_id) currentToneId = params.tone_id
    } catch {
      status = 'error'
      error = 'token_exchange_failed'
    }
  }

  destroyActiveView(win)
  if (!win.isDestroyed()) {
    win.webContents.send('oauth:selectComplete', { status, toneId: currentToneId, error })
  }
}

app.whenReady().then(() => {
  ipcMain.handle('oauth:beginSelect', (event, cfg: BeginSelectConfig, bounds: ViewBounds) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) beginSelect(win, cfg, bounds)
  })

  ipcMain.on('oauth:setSelectBounds', (_event, bounds: ViewBounds) => {
    activeView?.setBounds(bounds)
  })

  ipcMain.handle('oauth:endSelect', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) void finishFlow(win, { canceled: true })
  })

  ipcMain.handle('tokens:get', () => tokenStore.get())
  ipcMain.handle('tokens:set', (_event, tokens: T3KTokens) => tokenStore.set(tokens))
  ipcMain.handle('tokens:clear', () => {
    tokenStore.clear()
    currentToneId = undefined
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

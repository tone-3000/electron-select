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

// Route http(s) target=_blank / external links to the system browser instead of
// spawning an in-app window. Used for both the app window and the embedded
// TONE3000 view — only hand real web URLs to the OS, never an arbitrary scheme.
function openExternalHandler({ url }: { url: string }): { action: 'deny' } {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url)
  } catch {
    /* malformed URL — ignore */
  }
  return { action: 'deny' }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
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

// ─── Select flow (embedded WebContentsView, main-owned) ─────────────────────
//
// The flow runs in a WebContentsView laid into the window beside the app's
// sidebar — the React app stays mounted the whole time. TONE3000 gets its own
// web contents with NO preload, so window.t3k can never reach that origin.
//
// OAuth still lives in main because the redirect is captured on the *view's*
// webContents (via will-redirect / will-navigate), which the renderer can't
// listen to. Main generates the PKCE challenge, loads the authorize URL into the
// view, exchanges the code for tokens on the redirect back, then destroys the
// view and pushes the result to the renderer.

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
  p.set('prompt', 'select_tone')

  // Param names are verbatim from the TONE3000 select flow — do not rename.
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

// The live embedded view for the in-flight flow, and its PKCE state. Both are
// held only for the span of one flow and cleared in finishFlow.
let activeView: WebContentsView | null = null
let pending: { codeVerifier: string; state: string; cfg: BeginSelectConfig } | null = null
// The tone the app should display: the most recently selected one. Held in
// memory (like the view), so it survives a canceled re-browse but not a process
// restart — matching that tokens outlive restarts while the loaded tone doesn't.
let currentToneId: string | undefined
// Removes the navigation listeners installed on the active view's webContents.
let cleanupInterceptor: (() => void) | null = null

// Detach the embedded view from the window and dispose its web contents. The
// close is deferred to a microtask because this is often reached from inside one
// of the view's own navigation events (will-redirect), where tearing the
// contents down synchronously is unsafe.
function destroyActiveView(win: BrowserWindow): void {
  cleanupInterceptor?.()
  cleanupInterceptor = null
  const view = activeView
  activeView = null
  if (!view) return
  if (!win.isDestroyed()) win.contentView.removeChildView(view)
  queueMicrotask(() => view.webContents.close())
}

// Start the select flow: generate PKCE, create the embedded view at the bounds
// the renderer measured, install a one-shot navigation interceptor on the view's
// webContents, and load the authorize URL into it. The interceptor watches for
// the redirect back to redirectUri (a sentinel that nothing serves — it never
// actually loads) and hands off to finishFlow.
function beginSelect(win: BrowserWindow, cfg: BeginSelectConfig, bounds: ViewBounds): void {
  destroyActiveView(win) // tear down any prior flow that never settled
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  const state = base64url(randomBytes(16))
  pending = { codeVerifier, state, cfg }

  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  view.setBackgroundColor('#ffffff') // avoid a transparent flash before first paint
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

  // If the authorize endpoint itself errors (e.g. unknown client_id → HTTP 4xx
  // with no redirect), finish instead of leaving the user on an error page
  // inside the panel.
  const handleDidNavigate = (_e: Electron.Event, url: string, httpResponseCode: number): void => {
    if (url.startsWith(cfg.redirectUri)) return
    if (httpResponseCode >= 400) void finishFlow(win, { error: `authorize_failed_${httpResponseCode}` })
  }

  // A main-frame load failure (offline, DNS/TLS error) never fires did-navigate,
  // so surface it here. Ignore sub-frames and ERR_ABORTED (-3), which fires for
  // the redirect_uri navigation we cancel above.
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

  // Escape aborts the flow — a keyboard escape-hatch matching the renderer's
  // Cancel button.
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

// Resolve a flow: exchange the code if there is one, tear down the embedded
// view, and push the outcome to the renderer. Guarded on `pending` so multiple
// navigation events (a redirect plus a stray did-navigate) settle exactly once.
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
      // Only advance the displayed tone on a real selection; a canceled/errored
      // re-browse leaves currentToneId pointing at whatever was already loaded.
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

  // Fired continuously from the renderer as it (and the window) resize, keeping
  // the embedded view aligned to its DOM slot. Uses send (not invoke) — it's
  // fire-and-forget and can arrive many times per drag.
  ipcMain.on('oauth:setSelectBounds', (_event, bounds: ViewBounds) => {
    activeView?.setBounds(bounds)
  })

  // User dismissed the panel (Cancel button / Disconnect mid-flow).
  ipcMain.handle('oauth:endSelect', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) void finishFlow(win, { canceled: true })
  })

  ipcMain.handle('tokens:get', () => tokenStore.get())
  ipcMain.handle('tokens:set', (_event, tokens: T3KTokens) => tokenStore.set(tokens))
  ipcMain.handle('tokens:clear', () => {
    tokenStore.clear()
    // Forget the displayed tone too, so it isn't reloaded for a now-disconnected session.
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

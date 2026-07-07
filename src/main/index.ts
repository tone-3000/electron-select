import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { randomBytes, createHash } from 'node:crypto'
import { tokenStore } from './tokenStore'
import type { T3KTokens, BeginSelectConfig, SelectResult } from '../shared/types'

function loadApp(win: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
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

  // Any target=_blank / external link opens in the system browser, not in-app.
  // The window loads TONE3000 (a third-party origin) during the flow, so only
  // hand http(s) URLs to the OS — never an arbitrary scheme the page requests.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url)
    } catch {
      /* malformed URL — ignore */
    }
    return { action: 'deny' }
  })

  loadApp(win)

  return win
}

// ─── OAuth (main-owned) ─────────────────────────────────────────────────────
//
// The select flow navigates the main window itself to TONE3000 and, on the
// redirect back, reloads the local app. That teardown/rebuild destroys the
// renderer, so PKCE state and the callback must live here in the main process —
// the one component that survives the reload. Initiation + code→token exchange
// therefore run here; the renderer keeps only the live API session (T3KClient)
// and its refresh, which needs just the refresh_token it already holds.

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

// In-flight PKCE state, held only for the span of the flow (a single window
// navigation). Cleared as soon as the flow settles in finishFlow.
let pending: {
  codeVerifier: string
  state: string
  cfg: BeginSelectConfig
} | null = null
// The last completed flow's status, read by the renderer once it reloads. Reset
// when the next flow starts (and naturally on process restart), so the read is
// idempotent — the renderer can boot under StrictMode's double effect safely.
let lastStatus: SelectResult['status'] = 'none'
// The tone the app should display: the most recently selected one. Survives the
// in-session reloads (a canceled re-browse still restores it) but not a process
// restart, matching token persistence — tokens outlive restarts, tones don't.
let currentToneId: string | undefined
// Removes the navigation listeners installed for the in-flight flow.
let cleanupInterceptor: (() => void) | null = null

// Start the select flow: generate PKCE, install a one-shot navigation
// interceptor on the window, and send the window to the authorize URL. The
// interceptor watches for the redirect back to redirectUri (a sentinel that
// nothing serves — it never actually loads) and hands off to finishFlow.
function beginSelect(win: BrowserWindow, cfg: BeginSelectConfig): void {
  cleanupInterceptor?.() // detach listeners from any prior flow that never settled
  lastStatus = 'none' // drop the previous flow's status before starting a new one
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  const state = base64url(randomBytes(16))
  pending = { codeVerifier, state, cfg }

  const wc = win.webContents

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
  // with no redirect), finish instead of stranding the user on an error page
  // that has replaced the whole app.
  const handleDidNavigate = (_e: Electron.Event, url: string, httpResponseCode: number): void => {
    if (url.startsWith(cfg.redirectUri)) return
    if (httpResponseCode >= 400) void finishFlow(win, { error: `authorize_failed_${httpResponseCode}` })
  }

  // A main-frame load failure (offline, DNS/TLS error) never fires did-navigate,
  // so surface it here rather than leave the user on a Chromium error page with
  // the whole app gone. Ignore sub-frames and ERR_ABORTED (-3), which fires for
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

  // Escape aborts the flow — a guaranteed way back now that the app UI is gone.
  const handleInput = (_e: Electron.Event, input: Electron.Input): void => {
    if (input.type === 'keyDown' && input.key === 'Escape') void finishFlow(win, { canceled: true })
  }

  const detach = (): void => {
    wc.removeListener('will-redirect', handleNavigation)
    wc.removeListener('will-navigate', handleNavigation)
    wc.removeListener('did-navigate', handleDidNavigate)
    wc.removeListener('did-fail-load', handleFailLoad)
    wc.removeListener('before-input-event', handleInput)
  }
  cleanupInterceptor = detach

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

// Resolve a flow: record the result, tear down the interceptor, and send the
// window back to the local app. Guarded so multiple navigation events (e.g. a
// redirect plus a stray did-navigate) settle exactly once.
async function finishFlow(win: BrowserWindow, params: CallbackParams): Promise<void> {
  if (!pending) return
  const { codeVerifier, state, cfg } = pending
  pending = null
  cleanupInterceptor?.()
  cleanupInterceptor = null

  if (params.canceled && !params.code) {
    lastStatus = 'canceled'
  } else if (params.error) {
    lastStatus = 'error'
  } else if (params.state !== state) {
    lastStatus = 'error'
  } else if (!params.code) {
    lastStatus = 'error'
  } else {
    try {
      const tokens = await exchangeCode(cfg, params.code, codeVerifier)
      tokenStore.set(tokens)
      lastStatus = 'selected'
      // Only advance the displayed tone on a real selection; a canceled/errored
      // re-browse leaves currentToneId pointing at whatever was already loaded.
      if (params.tone_id) currentToneId = params.tone_id
    } catch {
      lastStatus = 'error'
    }
  }

  if (!win.isDestroyed()) loadApp(win)
}

app.whenReady().then(() => {
  ipcMain.handle('oauth:beginSelect', (event, cfg: BeginSelectConfig) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) beginSelect(win, cfg)
  })

  ipcMain.handle(
    'oauth:getSelectResult',
    (): SelectResult => ({ status: lastStatus, toneId: currentToneId })
  )

  ipcMain.handle('tokens:get', () => tokenStore.get())
  ipcMain.handle('tokens:set', (_event, tokens: T3KTokens) => tokenStore.set(tokens))
  ipcMain.handle('tokens:clear', () => {
    tokenStore.clear()
    // Forget the displayed tone too, so a later reload doesn't try to reload it
    // for a now-disconnected session.
    currentToneId = undefined
    lastStatus = 'none'
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

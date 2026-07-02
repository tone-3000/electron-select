/**
 * tone3000-client.ts — TONE3000 OAuth + API client, Electron edition.
 *
 * Adapted from the browser reference client. Two things differ from the web
 * build, and only two:
 *
 *   1. The OAuth redirect is caught by the Electron main process
 *      (window.t3k.authorize) instead of landing on a web-served page, because
 *      a packaged app has no web server for the redirect to hit.
 *
 *   2. Tokens are persisted via window.t3k.tokens (safeStorage on disk) instead
 *      of sessionStorage, so they survive quitting and relaunching the app.
 *
 * Everything else — PKCE, the token exchange, refresh, and the resource
 * methods — is the same as the browser client.
 */

import { T3K_API } from './config'
import type {
  User, Tone, Model, PaginatedResponse, ListModelsParams,
} from './types'

export interface T3KTokens {
  access_token: string
  refresh_token: string
  /** Unix timestamp (ms) when the access token expires. */
  expires_at: number
}

export type OAuthCallbackResult =
  | { ok: true; tokens: T3KTokens; toneId?: string; modelId?: string }
  | { ok: false; error: string }

// ─── PKCE helpers ───────────────────────────────────────────────────────────

async function randomBase64url(bytes: number): Promise<string> {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function sha256Base64url(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// PKCE state for the in-flight flow. The renderer window stays alive for the
// whole flow (the auth UI is a separate main-process window), so a module
// variable is enough — no storage needed, unlike the browser client which had
// to stash the verifier in sessionStorage across a full-page redirect.
let pending: { codeVerifier: string; state: string } | null = null

function buildAuthorizeUrl(
  publishableKey: string,
  redirectUri: string,
  extra: Record<string, string>,
  codeChallenge: string,
  state: string
): string {
  const url = new URL(`${T3K_API}/api/v1/oauth/authorize`)
  url.searchParams.set('client_id', publishableKey)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  return url.toString()
}

// ─── Select flow ──────────────────────────────────────────────────────────────

export interface SelectFlowOptions {
  gears?: string
  platform?: string
  menubar?: boolean
  architecture?: number
  calibrated?: boolean
  loginHint?: string
}

/**
 * Send the user to TONE3000 to browse and pick a tone. Opens the authorize URL
 * in an Electron child window (via the preload bridge); resolves once the flow
 * redirects back with a code, then exchanges it for tokens.
 */
export async function startSelectFlow(
  publishableKey: string,
  redirectUri: string,
  options?: SelectFlowOptions
): Promise<OAuthCallbackResult> {
  const codeVerifier = await randomBase64url(32)
  const [codeChallenge, state] = await Promise.all([
    sha256Base64url(codeVerifier),
    randomBase64url(16),
  ])
  pending = { codeVerifier, state }

  const extra: Record<string, string> = { prompt: 'select_tone' }
  if (options?.gears) extra.gears = options.gears
  if (options?.platform) extra.platform = options.platform
  if (options?.menubar) extra.menubar = 'true'
  if (options?.architecture) extra.architecture = options.architecture.toString()
  if (options?.calibrated) extra.calibrated = 'true'
  if (options?.loginHint) extra.login_hint = options.loginHint

  const url = buildAuthorizeUrl(publishableKey, redirectUri, extra, codeChallenge, state)
  const cb = await window.t3k.authorize(url, redirectUri)

  const saved = pending
  pending = null

  if (cb.canceled && !cb.code) return { ok: false, error: 'canceled' }
  if (cb.error) return { ok: false, error: cb.error }
  if (!saved || cb.state !== saved.state) return { ok: false, error: 'state_mismatch' }
  if (!cb.code) return { ok: false, error: 'missing_code' }

  return exchangeCode(publishableKey, redirectUri, cb.code, saved.codeVerifier, cb.tone_id)
}

async function exchangeCode(
  publishableKey: string,
  redirectUri: string,
  code: string,
  codeVerifier: string,
  toneId?: string
): Promise<OAuthCallbackResult> {
  const res = await fetch(`${T3K_API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: publishableKey,
    }),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: err.error ?? 'token_exchange_failed' }
  }

  const data = await res.json()
  return {
    ok: true,
    tokens: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    },
    toneId,
  }
}

/** Exchange a refresh token for a new access token. */
export async function refreshTokens(
  refreshToken: string,
  publishableKey: string
): Promise<T3KTokens> {
  const res = await fetch(`${T3K_API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: publishableKey,
    }),
  })

  if (!res.ok) throw new Error('Token refresh failed')

  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
}

// ─── Authenticated API client ─────────────────────────────────────────────────

/**
 * T3KClient — authenticated API client with automatic token refresh.
 *
 * Tokens live in memory for synchronous access and are hydrated from / written
 * through to the persistent store (window.t3k.tokens → safeStorage on disk).
 * Call `await hydrate()` once at startup before using the client; after that the
 * app is already connected across restarts with no re-auth.
 */
export class T3KClient {
  private tokens: T3KTokens | null = null
  private refreshPromise: Promise<T3KTokens> | null = null

  constructor(
    private readonly publishableKey: string,
    private readonly onAuthRequired: () => void
  ) {}

  /** Load persisted tokens into memory. Call once at app startup. */
  async hydrate(): Promise<void> {
    this.tokens = await window.t3k.tokens.get()
  }

  setTokens(tokens: T3KTokens): void {
    this.tokens = tokens
    void window.t3k.tokens.set(tokens)
  }

  getTokens(): T3KTokens | null {
    return this.tokens
  }

  clearTokens(): void {
    this.tokens = null
    void window.t3k.tokens.clear()
  }

  isConnected(): boolean {
    return this.tokens !== null
  }

  private async getAccessToken(): Promise<string> {
    const tokens = this.tokens
    if (!tokens) {
      this.onAuthRequired()
      throw new Error('Not authenticated')
    }

    // Proactively refresh 60s before expiry to avoid mid-request failures.
    if (Date.now() > tokens.expires_at - 60_000) {
      if (!this.refreshPromise) {
        this.refreshPromise = refreshTokens(tokens.refresh_token, this.publishableKey)
          .then((t) => { this.setTokens(t); this.refreshPromise = null; return t })
          .catch((err) => {
            this.clearTokens()
            this.refreshPromise = null
            this.onAuthRequired()
            throw err
          })
      }
      return (await this.refreshPromise).access_token
    }

    return tokens.access_token
  }

  /** Make an authenticated request to the TONE3000 API. */
  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getAccessToken()
    const res = await fetch(`${T3K_API}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    })

    // Retry once on 401 — handles expiry races between the refresh check and the request.
    if (res.status === 401 && this.tokens) {
      this.setTokens({ ...this.tokens, expires_at: 0 }) // force a refresh
      const retryToken = await this.getAccessToken()
      return fetch(`${T3K_API}${path}`, {
        ...init,
        headers: { ...init?.headers, Authorization: `Bearer ${retryToken}` },
      })
    }

    return res
  }

  async getUser(): Promise<User> {
    const res = await this.fetch('/api/v1/user')
    if (!res.ok) throw new Error(`getUser failed: ${res.status}`)
    return res.json()
  }

  async getTone(id: number | string): Promise<Tone> {
    const res = await this.fetch(`/api/v1/tones/${id}`)
    if (!res.ok) throw new Error(`getTone failed: ${res.status}`)
    return res.json()
  }

  async listModels(toneId: number | string, params?: ListModelsParams): Promise<PaginatedResponse<Model>> {
    const qs = new URLSearchParams()
    qs.set('tone_id', String(toneId))
    if (params?.page) qs.set('page', String(params.page))
    if (params?.pageSize) qs.set('page_size', String(params.pageSize))
    if (params?.architecture != null) qs.set('architecture', String(params.architecture))
    const res = await this.fetch(`/api/v1/models?${qs}`)
    if (!res.ok) throw new Error(`listModels failed: ${res.status}`)
    return res.json()
  }

  /**
   * Download a model file. The model_url must be fetched with Bearer auth — use
   * this method rather than a plain fetch. Triggers Electron's download manager.
   */
  async downloadModel(modelUrl: string, name: string): Promise<void> {
    const path = modelUrl.replace(T3K_API, '')
    const res = await this.fetch(path)
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)

    const storageFilename = new URL(modelUrl).pathname.split('/').pop() ?? ''
    const ext = storageFilename.includes('.') ? '.' + storageFilename.split('.').pop() : ''
    const sanitized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: url, download: sanitized + ext })
    a.click()
    URL.revokeObjectURL(url)
  }
}

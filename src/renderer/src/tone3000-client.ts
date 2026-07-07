/**
 * tone3000-client.ts — TONE3000 live API session.
 *
 * The OAuth select flow (PKCE + code→token exchange) runs in the Electron main
 * process — see src/main/index.ts — because it spans a window navigation that
 * tears down the renderer. This module owns only what lives with the renderer:
 * the authenticated API client and its token refresh, which needs just the
 * refresh_token the client already holds. Tokens are persisted through
 * window.t3k.tokens (safeStorage on disk) so they survive an app restart.
 */

import { T3K_API } from './config'
import type {
  User, Tone, Model, PaginatedResponse, ListModelsParams,
} from './types'
import type { T3KTokens } from '../../shared/types'

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

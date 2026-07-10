/**
 * Authenticated TONE3000 API client + token refresh.
 * OAuth (PKCE + code exchange) lives in the main process — see src/main/index.ts.
 * Tokens persist via window.t3k.tokens (safeStorage).
 */

import { T3K_API } from './config'
import type {
  User, Tone, Model, PaginatedResponse, ListModelsParams, ListTonesParams,
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

  if (!res.ok) throw new ApiError('Token refresh failed', res.status)

  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
}

/** API failure that preserves the HTTP status for callers. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(`${message}: ${status}`)
  }

  /** True for 403/429 (transient throttle / WAF deny). */
  get isRateLimit(): boolean {
    return this.status === 403 || this.status === 429
  }
}

/** Authenticated client with automatic token refresh. Call hydrate() once at startup. */
export class T3KClient {
  private tokens: T3KTokens | null = null
  private refreshPromise: Promise<T3KTokens> | null = null
  private userPromise: Promise<User> | null = null

  constructor(
    private readonly publishableKey: string,
    private readonly onAuthRequired: () => void
  ) {}

  /** Load persisted tokens into memory. */
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
    this.userPromise = null
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

    // Refresh 60s before expiry.
    if (Date.now() > tokens.expires_at - 60_000) {
      if (!this.refreshPromise) {
        this.refreshPromise = refreshTokens(tokens.refresh_token, this.publishableKey)
          .then((t) => { this.setTokens(t); this.refreshPromise = null; return t })
          .catch((err) => {
            this.refreshPromise = null
            // 400/401 = invalid_grant — clear session. Other errors are transient.
            if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
              this.clearTokens()
              this.onAuthRequired()
            }
            throw err
          })
      }
      return (await this.refreshPromise).access_token
    }

    return tokens.access_token
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getAccessToken()
    const res = await fetch(`${T3K_API}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    })

    // Retry once on 401 in case the token expired mid-request.
    if (res.status === 401 && this.tokens) {
      this.setTokens({ ...this.tokens, expires_at: 0 })
      const retryToken = await this.getAccessToken()
      return fetch(`${T3K_API}${path}`, {
        ...init,
        headers: { ...init?.headers, Authorization: `Bearer ${retryToken}` },
      })
    }

    return res
  }

  async getUser(): Promise<User> {
    if (!this.userPromise) {
      this.userPromise = this.fetch('/api/v1/user')
        .then((res) => {
          if (!res.ok) throw new ApiError('getUser failed', res.status)
          return res.json() as Promise<User>
        })
        .catch((err) => {
          this.userPromise = null
          throw err
        })
    }
    return this.userPromise
  }

  /** `architecture` filters models_count for NAM tones only; ignored otherwise. */
  async getTone(id: number | string, params?: { architecture?: number }): Promise<Tone> {
    const qs = new URLSearchParams()
    if (params?.architecture != null) qs.set('architecture', String(params.architecture))
    const res = await this.fetch(`/api/v1/tones/${id}${qs.size ? `?${qs}` : ''}`)
    if (!res.ok) throw new Error(`getTone failed: ${res.status}`)
    return res.json()
  }

  private async listTones(endpoint: string, params?: ListTonesParams): Promise<PaginatedResponse<Tone>> {
    const qs = new URLSearchParams()
    if (params?.page) qs.set('page', String(params.page))
    if (params?.pageSize) qs.set('page_size', String(params.pageSize))
    const res = await this.fetch(`/api/v1/tones/${endpoint}?${qs}`)
    if (!res.ok) throw new ApiError(`list ${endpoint} tones failed`, res.status)
    return res.json()
  }

  async listFavoritedTones(params?: ListTonesParams): Promise<PaginatedResponse<Tone>> {
    return this.listTones('favorited', params)
  }

  async listCreatedTones(params?: ListTonesParams): Promise<PaginatedResponse<Tone>> {
    return this.listTones('created', params)
  }

  async listDownloadedTones(params?: ListTonesParams): Promise<PaginatedResponse<Tone>> {
    return this.listTones('downloaded', params)
  }

  /** Top 10 trending tones for a gear type. Not paginated. */
  async listTrendingTones(gear: string): Promise<{ data: Tone[] }> {
    const res = await this.fetch(`/api/v1/tones/trending?gear=${encodeURIComponent(gear)}`)
    if (!res.ok) throw new ApiError('listTrendingTones failed', res.status)
    return res.json()
  }

  /** 10 most recently published tones. Not paginated. */
  async listLatestTones(): Promise<{ data: Tone[] }> {
    const res = await this.fetch('/api/v1/tones/latest')
    if (!res.ok) throw new ApiError('listLatestTones failed', res.status)
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

  /** Download a model file (model_url requires Bearer auth — don't fetch it directly). */
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

export {}

interface T3KTokens {
  access_token: string
  refresh_token: string
  expires_at: number
}

interface AuthorizeResult {
  code?: string
  state?: string
  error?: string
  tone_id?: string
  model_id?: string
  canceled?: boolean
}

declare global {
  interface Window {
    // Bridge exposed by the preload script (see src/preload/index.ts).
    t3k: {
      authorize(authorizeUrl: string, redirectUri: string): Promise<AuthorizeResult>
      tokens: {
        get(): Promise<T3KTokens | null>
        set(tokens: T3KTokens): Promise<void>
        clear(): Promise<void>
      }
    }
  }
}

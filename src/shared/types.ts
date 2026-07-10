/** Shared IPC types for main, preload, and renderer. */

export interface T3KTokens {
  access_token: string
  refresh_token: string
  /** Unix timestamp (ms) when the access token expires. */
  expires_at: number
}

/** Authorize URL options. Param names match the TONE3000 API. */
export interface SelectFlowOptions {
  gears?: string
  platform?: string
  menubar?: boolean
  architecture?: number
  calibrated?: boolean
  loginHint?: string
}

/** Config the renderer passes to main to start an embedded OAuth flow. */
export interface BeginSelectConfig {
  publishableKey: string
  redirectUri: string
  apiDomain: string
  /** `select_tone` for browse+pick; omit for login-only. */
  prompt?: 'select_tone'
  options?: SelectFlowOptions
}

/** Bounds for the embedded WebContentsView (DIP, relative to content area). */
export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Outcome pushed to the renderer when the embedded flow finishes. */
export interface SelectResult {
  status: 'selected' | 'canceled' | 'error' | 'none'
  toneId?: string
  error?: string
}

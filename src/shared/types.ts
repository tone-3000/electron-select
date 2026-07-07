/**
 * Shared type definitions for the TONE3000 select flow.
 *
 * Imported (type-only) by the main process, the preload bridge, and the
 * renderer so all three stay in lockstep — these types cross the IPC boundary,
 * and a single source keeps them from drifting.
 */

export interface T3KTokens {
  access_token: string
  refresh_token: string
  /** Unix timestamp (ms) when the access token expires. */
  expires_at: number
}

/** Options that shape the TONE3000 authorize URL. Param names are verbatim. */
export interface SelectFlowOptions {
  gears?: string
  platform?: string
  menubar?: boolean
  architecture?: number
  calibrated?: boolean
  loginHint?: string
}

/** Everything the renderer hands main to kick off a select flow. */
export interface BeginSelectConfig {
  publishableKey: string
  redirectUri: string
  apiDomain: string
  options?: SelectFlowOptions
}

/**
 * Outcome of the most recent select flow, read by the renderer once it reloads.
 * `toneId` is the tone to display — the most recently selected one — carried on
 * every status so a canceled/errored re-browse still restores the loaded tone.
 */
export interface SelectResult {
  status: 'selected' | 'canceled' | 'error' | 'none'
  toneId?: string
  /** Present when status is 'error'. */
  error?: string
}

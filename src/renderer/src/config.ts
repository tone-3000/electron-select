// TONE3000 API configuration. Values come from Vite env (.env) at build time.
export const T3K_API = (
  (import.meta.env.VITE_T3K_API_DOMAIN as string | undefined) ?? 'https://www.tone3000.com'
).replace(/\/+$/, '')

export const PUBLISHABLE_KEY = import.meta.env.VITE_PUBLISHABLE_KEY as string

export const PUBLISHABLE_KEY_SELECT =
  (import.meta.env.VITE_PUBLISHABLE_KEY_SELECT as string | undefined) ?? PUBLISHABLE_KEY

// Sentinel redirect URI: the main process intercepts navigation to it and reads
// the auth code off the URL — nothing serves it. Must be registered for the key.
export const REDIRECT_URI =
  (import.meta.env.VITE_REDIRECT_URI as string | undefined) ?? 'http://localhost:3001/callback'

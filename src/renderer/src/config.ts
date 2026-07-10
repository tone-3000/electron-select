// TONE3000 API config from Vite env (.env).
export const T3K_API = (
  (import.meta.env.VITE_T3K_API_DOMAIN as string | undefined) ?? 'https://www.tone3000.com'
).replace(/\/+$/, '')

export const PUBLISHABLE_KEY = import.meta.env.VITE_PUBLISHABLE_KEY as string

export const PUBLISHABLE_KEY_SELECT =
  (import.meta.env.VITE_PUBLISHABLE_KEY_SELECT as string | undefined) ?? PUBLISHABLE_KEY

// Sentinel redirect URI — main intercepts navigation to it; nothing serves it.
export const REDIRECT_URI =
  (import.meta.env.VITE_REDIRECT_URI as string | undefined) ?? 'http://localhost:3001/callback'

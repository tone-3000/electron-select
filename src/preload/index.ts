import { contextBridge, ipcRenderer } from 'electron'

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

// The renderer's only channel to the main process: run the auth flow and
// read/write the persisted token store (safeStorage-backed on disk).
const t3k = {
  authorize: (authorizeUrl: string, redirectUri: string): Promise<AuthorizeResult> =>
    ipcRenderer.invoke('oauth:authorize', { authorizeUrl, redirectUri }),
  tokens: {
    get: (): Promise<T3KTokens | null> => ipcRenderer.invoke('tokens:get'),
    set: (tokens: T3KTokens): Promise<void> => ipcRenderer.invoke('tokens:set', tokens),
    clear: (): Promise<void> => ipcRenderer.invoke('tokens:clear'),
  },
}

contextBridge.exposeInMainWorld('t3k', t3k)

export type T3KBridge = typeof t3k

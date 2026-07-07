import { contextBridge, ipcRenderer } from 'electron'
import type { T3KTokens, BeginSelectConfig, SelectResult } from '../shared/types'

// The renderer's only channel to the main process: start the select flow, read
// its result on reload, and read/write the persisted token store (safeStorage).
const t3k = {
  beginSelect: (config: BeginSelectConfig): Promise<void> =>
    ipcRenderer.invoke('oauth:beginSelect', config),
  getSelectResult: (): Promise<SelectResult> => ipcRenderer.invoke('oauth:getSelectResult'),
  tokens: {
    get: (): Promise<T3KTokens | null> => ipcRenderer.invoke('tokens:get'),
    set: (tokens: T3KTokens): Promise<void> => ipcRenderer.invoke('tokens:set', tokens),
    clear: (): Promise<void> => ipcRenderer.invoke('tokens:clear'),
  },
}

// Security-critical: during the select flow the main window navigates itself to
// www.tone3000.com, and this preload runs on *every* document in that window.
// Expose window.t3k only to our own app — never to the TONE3000 origin, which
// would otherwise gain access to the token store. The app is served from
// file:// (packaged) or the dev renderer URL (electron-vite).
const rendererUrl = process.env['ELECTRON_RENDERER_URL']
// `location` exists at runtime (preload runs in the renderer) but the main/
// preload tsconfig has no DOM lib, so reach it through a minimal typed view.
const loc = (globalThis as unknown as { location: { protocol: string; href: string } }).location

// Compare full origins, not a string prefix: `href.startsWith(rendererUrl)`
// would also accept a look-alike host like `http://localhost:5173.evil.com`.
function sameOrigin(href: string, base: string): boolean {
  try {
    return new URL(href).origin === new URL(base).origin
  } catch {
    return false
  }
}

const isAppOrigin =
  loc.protocol === 'file:' || (!!rendererUrl && sameOrigin(loc.href, rendererUrl))

if (isAppOrigin) contextBridge.exposeInMainWorld('t3k', t3k)

export type T3KBridge = typeof t3k

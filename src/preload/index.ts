import { contextBridge, ipcRenderer } from 'electron'
import type { T3KTokens, BeginSelectConfig, SelectResult, ViewBounds } from '../shared/types'

// The renderer's only channel to the main process: drive the embedded select
// flow (start it, keep the view aligned to its DOM slot, cancel it, hear its
// result) and read/write the persisted token store (safeStorage).
const t3k = {
  beginSelect: (config: BeginSelectConfig, bounds: ViewBounds): Promise<void> =>
    ipcRenderer.invoke('oauth:beginSelect', config, bounds),
  setSelectBounds: (bounds: ViewBounds): void =>
    ipcRenderer.send('oauth:setSelectBounds', bounds),
  endSelect: (): Promise<void> => ipcRenderer.invoke('oauth:endSelect'),
  // Main pushes the outcome when it tears the embedded view down. Returns an
  // unsubscribe fn so the renderer can detach on unmount.
  onSelectComplete: (callback: (result: SelectResult) => void): (() => void) => {
    const listener = (_e: unknown, result: SelectResult): void => callback(result)
    ipcRenderer.on('oauth:selectComplete', listener)
    return () => ipcRenderer.removeListener('oauth:selectComplete', listener)
  },
  tokens: {
    get: (): Promise<T3KTokens | null> => ipcRenderer.invoke('tokens:get'),
    set: (tokens: T3KTokens): Promise<void> => ipcRenderer.invoke('tokens:set', tokens),
    clear: (): Promise<void> => ipcRenderer.invoke('tokens:clear'),
  },
}

// Defense-in-depth. TONE3000 now loads in a separate WebContentsView that is
// created with no preload, so window.t3k already can't reach that origin. This
// gate keeps the guarantee even if this preload is ever attached to a window
// that navigates to a third-party origin: expose window.t3k only to our own app
// (file:// when packaged, or the dev renderer URL), never to any other origin,
// which would otherwise gain access to the token store.
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

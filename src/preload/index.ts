import { contextBridge, ipcRenderer } from 'electron'
import type { T3KTokens, BeginSelectConfig, SelectResult, ViewBounds } from '../shared/types'

const t3k = {
  beginSelect: (config: BeginSelectConfig, bounds: ViewBounds): Promise<void> =>
    ipcRenderer.invoke('oauth:beginSelect', config, bounds),
  setSelectBounds: (bounds: ViewBounds): void =>
    ipcRenderer.send('oauth:setSelectBounds', bounds),
  endSelect: (): Promise<void> => ipcRenderer.invoke('oauth:endSelect'),
  /** Subscribe to flow completion. Returns an unsubscribe fn. */
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

// Only expose the bridge to our app origin (file:// or the Vite dev URL).
// The TONE3000 WebContentsView has no preload, so it never sees window.t3k.
const rendererUrl = process.env['ELECTRON_RENDERER_URL']
const loc = (globalThis as unknown as { location: { protocol: string; href: string } }).location

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

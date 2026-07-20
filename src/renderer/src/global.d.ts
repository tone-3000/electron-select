import type { T3KTokens, BeginSelectConfig, SelectResult, ViewBounds } from '../../shared/types'

declare global {
  interface Window {
    t3k: {
      beginSelect(config: BeginSelectConfig, bounds: ViewBounds): Promise<void>
      setSelectBounds(bounds: ViewBounds): void
      endSelect(): Promise<void>
      onSelectComplete(callback: (result: SelectResult) => void): () => void
      fetchZip(url: string): Promise<ArrayBuffer>
      tokens: {
        get(): Promise<T3KTokens | null>
        set(tokens: T3KTokens): Promise<void>
        clear(): Promise<void>
      }
    }
  }
}

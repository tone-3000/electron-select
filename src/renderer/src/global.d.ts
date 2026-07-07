import type { T3KTokens, BeginSelectConfig, SelectResult } from '../../shared/types'

declare global {
  interface Window {
    // Bridge exposed by the preload script (see src/preload/index.ts).
    t3k: {
      beginSelect(config: BeginSelectConfig): Promise<void>
      getSelectResult(): Promise<SelectResult>
      tokens: {
        get(): Promise<T3KTokens | null>
        set(tokens: T3KTokens): Promise<void>
        clear(): Promise<void>
      }
    }
  }
}

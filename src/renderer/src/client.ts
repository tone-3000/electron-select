import { T3KClient } from './tone3000-client'
import { PUBLISHABLE_KEY_SELECT } from './config'

// One shared client. Tokens persist across restarts via the safeStorage-backed
// store in the main process (see hydrate/setTokens in tone3000-client.ts).
export const t3kClient = new T3KClient(PUBLISHABLE_KEY_SELECT, handleAuthRequired)

function handleAuthRequired(): void {
  // Refresh token is exhausted/invalid — drop persisted tokens so the UI falls
  // back to the connect state on the next render.
  t3kClient.clearTokens()
}

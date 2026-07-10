import { T3KClient } from './tone3000-client'
import { PUBLISHABLE_KEY_SELECT } from './config'

export const t3kClient = new T3KClient(PUBLISHABLE_KEY_SELECT, handleAuthRequired)

function handleAuthRequired(): void {
  t3kClient.clearTokens()
}

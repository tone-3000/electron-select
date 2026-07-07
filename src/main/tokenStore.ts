import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import type { T3KTokens } from '../shared/types'

// Encrypted store is the default. The plaintext fallback only kicks in when the
// OS keychain is unavailable (e.g. a Linux box with no Secret Service / keyring).
const encPath = () => join(app.getPath('userData'), 'tokens.enc')
const plainPath = () => join(app.getPath('userData'), 'tokens.json')

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export const tokenStore = {
  get(): T3KTokens | null {
    try {
      if (canEncrypt() && existsSync(encPath())) {
        return JSON.parse(safeStorage.decryptString(readFileSync(encPath())))
      }
      if (existsSync(plainPath())) {
        return JSON.parse(readFileSync(plainPath(), 'utf8'))
      }
      return null
    } catch {
      return null
    }
  },

  set(tokens: T3KTokens): void {
    if (canEncrypt()) {
      writeFileSync(encPath(), safeStorage.encryptString(JSON.stringify(tokens)))
    } else {
      console.warn('[tokenStore] OS encryption unavailable — storing tokens in plaintext.')
      writeFileSync(plainPath(), JSON.stringify(tokens), 'utf8')
    }
  },

  clear(): void {
    for (const p of [encPath(), plainPath()]) {
      if (existsSync(p)) rmSync(p)
    }
  },
}

import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { tokenStore, type T3KTokens } from './tokenStore'

interface AuthorizeResult {
  code?: string
  state?: string
  error?: string
  tone_id?: string
  model_id?: string
  canceled?: boolean
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  // Any target=_blank / external link opens in the system browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Open the TONE3000 authorize URL in a child window and resolve once the flow
// redirects back to redirectUri. We intercept that navigation in the main
// process and read the authorization code off the URL — there is no web server
// listening on redirectUri, so it never actually loads.
function runAuthorize(
  parent: BrowserWindow,
  authorizeUrl: string,
  redirectUri: string
): Promise<AuthorizeResult> {
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 480,
      height: 760,
      parent,
      // Not modal: a macOS modal child renders as a title-bar-less sheet with no
      // close button, which strands the user if the page is an error rather than
      // a redirect. A normal framed child window keeps standard window controls.
      show: false,
      title: 'Sign in to TONE3000',
      autoHideMenuBar: true,
      // Auth window shows a third-party page (tone3000); keep it isolated: no preload, no Node.
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })

    let settled = false
    const finish = (result: AuthorizeResult): void => {
      if (settled) return
      settled = true
      if (!authWin.isDestroyed()) authWin.close()
      resolve(result)
    }

    const handleNavigation = (event: Electron.Event, url: string): void => {
      if (!url.startsWith(redirectUri)) return
      event.preventDefault()
      const params = new URL(url).searchParams
      finish({
        code: params.get('code') ?? undefined,
        state: params.get('state') ?? undefined,
        error: params.get('error') ?? undefined,
        tone_id: params.get('tone_id') ?? undefined,
        model_id: params.get('model_id') ?? undefined,
        canceled: params.get('canceled') === 'true',
      })
    }

    authWin.webContents.on('will-redirect', handleNavigation)
    authWin.webContents.on('will-navigate', handleNavigation)

    // If the authorize endpoint itself errors (e.g. unknown client_id → HTTP 4xx
    // with no redirect), close and surface it instead of stranding the user on
    // an error page.
    authWin.webContents.on('did-navigate', (_event, url, httpResponseCode) => {
      if (url.startsWith(redirectUri)) return
      if (httpResponseCode >= 400) finish({ error: `authorize_failed_${httpResponseCode}` })
    })

    // Esc closes the window (resolves as canceled via the 'closed' handler).
    authWin.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !authWin.isDestroyed()) {
        authWin.close()
      }
    })

    // User closed the window before finishing → treat as canceled.
    authWin.on('closed', () => finish({ canceled: true }))

    authWin.once('ready-to-show', () => authWin.show())
    void authWin.loadURL(authorizeUrl)
  })
}

app.whenReady().then(() => {
  ipcMain.handle(
    'oauth:authorize',
    (event, { authorizeUrl, redirectUri }: { authorizeUrl: string; redirectUri: string }) => {
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent) return { canceled: true } satisfies AuthorizeResult
      return runAuthorize(parent, authorizeUrl, redirectUri)
    }
  )

  ipcMain.handle('tokens:get', () => tokenStore.get())
  ipcMain.handle('tokens:set', (_event, tokens: T3KTokens) => tokenStore.set(tokens))
  ipcMain.handle('tokens:clear', () => tokenStore.clear())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

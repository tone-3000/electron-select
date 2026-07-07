# TONE3000 × Electron — Select Flow Example

A minimal [Electron](https://www.electronjs.org/) reference integration for the
**TONE3000 select flow**: the user clicks "Browse Tones on TONE3000", picks a tone
on TONE3000 (in the same app window), and the app receives the tone plus its
downloadable model files. It is the desktop counterpart to the web select demo in the
[TONE3000 API examples](https://www.tone3000.com/api).

Built with **electron-vite** (Electron + Vite + React + TypeScript).

---

## How it works

The whole flow lives in **one window**. Clicking "Browse Tones on TONE3000" navigates
the app window itself to TONE3000 — like a browser tab — and when TONE3000 redirects
back, the window returns to the app with the chosen tone. There's no popup and no second
window to manage. Two things are handled specially to fit a desktop app.

### Token persistence (safeStorage)

Tokens are persisted so the user stays signed in across app restarts. They're stored
with Electron's built-in
[`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) — encrypted
with the OS keychain (macOS Keychain / Windows DPAPI / Linux libsecret) and written to
`userData/tokens.enc`.

- `src/main/tokenStore.ts` — encrypt/decrypt ↔ `userData/tokens.enc`
- `src/preload/index.ts` — exposes `window.t3k.tokens.{get,set,clear}`
- `src/renderer/src/tone3000-client.ts` — `T3KClient` hydrates from the store once at
  boot and writes through on every change; `getTokens()` stays synchronous.
- `src/renderer/src/App.tsx` — awaits hydration before first render, so the app comes
  up already connected.

### Same-window OAuth (main process owns it)

The renderer asks the main process to start the flow (`window.t3k.beginSelect`). The main
process generates the PKCE challenge, navigates the app window to the authorize URL, and
watches for the redirect back to `redirect_uri`. On that redirect it exchanges the `code`
for tokens, persists them (above), records which tone was chosen, and reloads the local
app. The rebuilt renderer reads the outcome with `window.t3k.getSelectResult()` and
loads the tone.

- `src/main/index.ts` — `beginSelect()` starts the flow and installs a navigation
  interceptor (`will-redirect` / `will-navigate`, plus 4xx and load-failure safety nets and
  an Escape escape-hatch); `finishFlow()` exchanges the code, persists tokens, and reloads
  the app.

**Why OAuth lives in main:** navigating the window away tears down and rebuilds the
renderer, so the in-flight PKCE verifier and the callback can't live there. The main
process survives the reload, so it owns *initiation + code→token exchange*. The renderer
keeps only the live session — `T3KClient` and its token refresh (`tone3000-client.ts`),
which need just the `refresh_token` already in hand.

The `redirect_uri` is a sentinel — nothing needs to serve it, because the navigation is
intercepted before it loads. It must still be registered in your API key's allowed
redirect URIs (localhost origins are auto-allowed in development).

API requests are made directly from the renderer: the TONE3000 API returns
`Access-Control-Allow-Origin: *` and uses Bearer auth, so cross-origin `fetch` works
from the app.

### Keeping the bridge off the TONE3000 origin

Because the app window navigates to `www.tone3000.com` during the flow, and the preload
runs on every page loaded in that window, the preload only exposes `window.t3k` when the
loaded page is our own app (`file://` when packaged, or the dev renderer URL). On the
TONE3000 origin `window.t3k` is `undefined`, so a third-party page can never reach the
token store. See the origin check in `src/preload/index.ts`.

---

## Quick start

### 1. Get an API key

1. Log in to [tone3000.com](https://www.tone3000.com) → **Settings → API Keys**
2. Create a key — you'll get a `t3k_pub_…` publishable key
3. Add your redirect URI (default `http://localhost:3001/callback`) to the key's allowed
   redirect URIs. Localhost origins are auto-allowed in development.

### 2. Configure

```bash
cp .env.example .env
```

Set `VITE_PUBLISHABLE_KEY` in `.env`. Optionally override `VITE_REDIRECT_URI` and
`VITE_T3K_API_DOMAIN`.

### 3. Run

```bash
npm install
npm run dev
```

An Electron window opens on the "No Tone Loaded" state. Click **Browse Tones on
TONE3000** — the same window navigates to TONE3000. Sign in and pick a tone; the window
returns to the app with the tone and its models.

**Verify persistence:** fully quit the app (Cmd+Q) and relaunch. It comes up already
showing **"Signed in as @you"** with no login — the token is read back from `safeStorage`
and used to call the API on boot. On macOS the persisted file is
`~/Library/Application Support/electron-select/tokens.enc` (ciphertext). Clicking
**Disconnect** deletes it.

### 4. Package

```bash
npm run dist        # installer for the current OS via electron-builder
npm run dist:dir    # unpacked app directory (faster, for local testing)
```

The packaged app runs from `file://`; the redirect capture and token storage work the
same way, with no local server.

---

## Project layout

```
src/
  main/
    index.ts        # window lifecycle; select flow (PKCE + redirect capture + exchange); token IPC
    tokenStore.ts   # safeStorage-encrypted token file in userData
  preload/
    index.ts        # contextBridge → window.t3k (origin-gated); beginSelect / getSelectResult / tokens
  renderer/
    index.html
    src/
      main.tsx
      App.tsx             # hydrate tokens + read select result, then render
      apps/SelectApp.tsx  # the select-flow UI
      tone3000-client.ts  # live API client + token refresh (session only; OAuth lives in main)
      client.ts           # shared T3KClient instance
      config.ts           # env config
      components/          # ToneCard, ModelList (download-only), etc.
  shared/
    types.ts        # types shared across main, preload, and renderer (the IPC surface)
```

## Notes

- Model files are downloaded via authenticated Bearer requests (see
  `T3KClient.downloadModel`). The web demo's in-app WASM preview player is omitted to keep
  the example focused.
- This example does not set a Content-Security-Policy; a production app should.
- Full API reference: [tone3000.com/api](https://www.tone3000.com/api).
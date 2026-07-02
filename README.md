# TONE3000 × Electron — Select Flow Example

A minimal [Electron](https://www.electronjs.org/) reference integration for the
**TONE3000 select flow**: the user clicks "Browse Tones on TONE3000", picks a tone
in a TONE3000 window, and the app receives the tone plus its downloadable model
files. It is the desktop counterpart to the web select demo in the
[TONE3000 API examples](https://www.tone3000.com/api).

Built with **electron-vite** (Electron + Vite + React + TypeScript).

---

## How it works

The OAuth and API logic mirrors the web select client (`tone3000-client.ts`). Two
things are handled differently to fit a desktop app.

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

### Capturing the OAuth redirect

The authorize flow opens in a child window. When it redirects back to `redirect_uri`,
the main process intercepts that navigation and reads `code` / `state` / `tone_id`
straight off the URL. The renderer then exchanges the `code` for tokens and saves them
(above).

- `src/main/index.ts` — `runAuthorize()` opens the authorize URL, listens for
  `will-redirect` / `will-navigate`, resolves with the callback params, and closes the
  window.

The `redirect_uri` is a sentinel — nothing needs to serve it, because the navigation is
intercepted before it loads. It must still be registered in your API key's allowed
redirect URIs (localhost origins are auto-allowed in development).

API requests are made directly from the renderer: the TONE3000 API returns
`Access-Control-Allow-Origin: *` and uses Bearer auth, so cross-origin `fetch` works
from the app.

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
TONE3000**, sign in, and pick a tone — it loads back in the app with its models.

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
    index.ts        # window lifecycle; oauth:authorize (redirect capture); token IPC
    tokenStore.ts   # safeStorage-encrypted token file in userData
  preload/
    index.ts        # contextBridge → window.t3k
  renderer/
    index.html
    src/
      main.tsx
      App.tsx             # hydrate persisted tokens, then render
      apps/SelectApp.tsx  # the select-flow UI
      tone3000-client.ts  # OAuth + API client (adapted from the web demo)
      client.ts           # shared T3KClient instance
      config.ts           # env config
      components/          # ToneCard, ModelList (download-only), etc.
```

## Notes

- Model files are downloaded via authenticated Bearer requests (see
  `T3KClient.downloadModel`). The web demo's in-app WASM preview player is omitted to keep
  the example focused.
- This example does not set a Content-Security-Policy; a production app should.
- Full API reference: [tone3000.com/api](https://www.tone3000.com/api).
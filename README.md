# TONE3000 × Electron — Select Flow Example

A minimal [Electron](https://www.electronjs.org/) reference integration for the
**TONE3000 API**. On first launch a welcome screen connects the user's TONE3000 account
via the **standard OAuth flow** (embedded in a panel beside the app's own sidebar). Once
signed in, the app shows tabs for tones **Loaded on Acme**, plus the user's TONE3000
**Favorites**, **Created**, and **Recents** (downloaded) lists via the REST API — any of
them can be loaded into the app with one click. "Browse Tones on TONE3000" launches the
**select flow**, where the user picks a tone in TONE3000's own catalog UI. Loaded tones
expose their downloadable model files. It is the desktop counterpart to the web demos in
the [TONE3000 API examples](https://www.tone3000.com/api).

Built with **electron-vite** (Electron + Vite + React + TypeScript).

---

## How it works

The app's UI — sidebar, header, chrome — stays mounted the whole time. Both OAuth flows
(the welcome screen's "Log into TONE3000" standard authorization and the select flow's
"Browse Tones") open TONE3000 in an embedded
[`WebContentsView`](https://www.electronjs.org/docs/latest/api/web-contents-view)
laid into the content region beside the sidebar; the only difference is whether the
authorize URL carries `prompt=select_tone`. When TONE3000 redirects back, the main
process removes the view and hands the app the outcome (tokens, plus the chosen tone for
the select flow) — no popup, no second window, and the app never navigates away from
itself. After sign-in, the Favorites / Created / Recents tabs call the REST endpoints
(`/api/v1/tones/favorited`, `/created`, `/downloaded`) directly from the renderer via
`T3KClient`. Two things are handled specially to fit a desktop app.

### Token persistence (safeStorage)

Tokens are persisted so the user stays signed in across app restarts. They're stored
with Electron's built-in
[`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) — encrypted
with the OS keychain (macOS Keychain / Windows DPAPI / Linux libsecret) and written to
`userData/tokens.enc`.

- `src/main/tokenStore.ts` — encrypt/decrypt ↔ `userData/tokens.enc`
- `src/preload/index.ts` — exposes `window.t3k.tokens.{get,set,clear}`
- `src/renderer/src/tone3000-client.ts` — `T3KClient` hydrates from the store at boot and
  again when a select flow completes, and writes through on every change; `getTokens()`
  stays synchronous.
- `src/renderer/src/App.tsx` — awaits hydration before first render, so the app comes
  up already connected.

### Embedded OAuth (main process owns it)

The renderer measures the DOM slot beside its sidebar and asks the main process to start
the flow (`window.t3k.beginSelect(config, bounds)`). Main generates the PKCE challenge,
creates a `WebContentsView` at those bounds, loads the authorize URL into it, and watches
that view's web contents for the redirect back to `redirect_uri`. On the redirect it
exchanges the `code` for tokens, persists them (above), records which tone was chosen,
then destroys the view and pushes the outcome to the renderer. The renderer re-hydrates
its token client from the store (it never reloaded, so its in-memory tokens are stale)
and loads the tone.

- `src/main/index.ts` — `beginSelect()` creates the embedded view and installs a
  navigation interceptor on **its** web contents (`will-redirect` / `will-navigate`, plus
  4xx and load-failure safety nets and an Escape escape-hatch); `finishFlow()` exchanges
  the code, persists tokens, tears the view down, and sends `oauth:selectComplete`.
- The renderer keeps the view aligned to its slot via `window.t3k.setSelectBounds(bounds)`
  (fired from a `ResizeObserver` + window `resize`), and hears the result through
  `window.t3k.onSelectComplete(...)`. See `src/renderer/src/apps/SelectApp.tsx`.

**Why OAuth lives in main:** the redirect is captured on the *view's* web contents, which
the renderer can't attach navigation listeners to. So main owns the view and therefore
*initiation + code→token exchange*. The renderer keeps only the live session — `T3KClient`
and its token refresh (`tone3000-client.ts`), which need just the `refresh_token` already
in hand. (The renderer no longer tears down mid-flow, so this could move to the renderer;
keeping it in main is what lets TONE3000 render in a view with no bridge — see below.)

**Bounds are in device-independent pixels.** The renderer's `getBoundingClientRect` and
main's `view.setBounds` share the window's content-area coordinate space, so they line up
at the default zoom. A production app that supports zoom should scale by
`webContents.getZoomFactor()`.

The `redirect_uri` is a sentinel — nothing needs to serve it, because the navigation is
intercepted before it loads. It must still be registered in your API key's allowed
redirect URIs (localhost origins are auto-allowed in development).

API requests are made directly from the renderer: the TONE3000 API returns
`Access-Control-Allow-Origin: *` and uses Bearer auth, so cross-origin `fetch` works
from the app.

### Keeping the bridge off the TONE3000 origin

The embedded view that loads `www.tone3000.com` is created with **no preload**, so
`window.t3k` simply doesn't exist there — a third-party page can never reach the token
store. As defense-in-depth, the app's own preload also gates `window.t3k` to our origin
(`file://` when packaged, or the dev renderer URL), so the guarantee holds even if that
preload were ever attached to a window that navigates elsewhere. See the origin check in
`src/preload/index.ts`.

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

An Electron window opens on the welcome screen. Click **Log into TONE3000** — TONE3000
fills the area beside the sidebar (the app UI stays visible) and you sign in; the panel
closes and the main screen appears. From there, load tones from the **T3K Favorites /
Created / Recents** tabs with one click, or click **Browse Tones on TONE3000** to pick a
tone from the catalog via the select flow. Loaded tones collect under **Loaded on Acme**
with their downloadable models. Use TONE3000's own close button (`menubar=true`) or press
**Escape** to close the embedded panel without finishing a flow.

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
    index.ts        # window lifecycle; embedded select view (PKCE + redirect capture + exchange); token IPC
    tokenStore.ts   # safeStorage-encrypted token file in userData
  preload/
    index.ts        # contextBridge → window.t3k (origin-gated); beginSelect / setSelectBounds / endSelect / onSelectComplete / tokens
  renderer/
    index.html
    src/
      main.tsx
      App.tsx             # hydrate tokens, then render
      apps/SelectApp.tsx  # select-flow UI: sidebar + embedded browse panel (measures bounds, syncs the view)
      tone3000-client.ts  # live API client + token refresh (session only; OAuth lives in main)
      client.ts           # shared T3KClient instance
      config.ts           # env config
      components/          # ToneCard, ModelList (download-only), etc.
  shared/
    types.ts        # types shared across main, preload, and renderer (the IPC surface)
```

## Notes

- **This `zip` branch** wires up the [Download Tone](https://www.tone3000.com/api#tones)
  endpoint: each loaded tone card gets a **Download .zip** button that fetches
  `GET /api/v1/tones/{id}/download` (via `T3KClient.getToneDownload`) and then downloads
  the returned temporary URL — a zip archive of *all* the tone's models
  (`T3KClient.downloadToneZip`). The URL expires an hour after being issued, so it's
  requested fresh on every click. The pre-signed URL needs no auth header, but the
  storage host serving it doesn't send CORS headers, so the renderer can't fetch it
  directly — the bytes are fetched in the **main process** (`download:fetchZip` IPC,
  Electron `net.fetch`) and saved from the renderer via a blob anchor. Note this
  endpoint is available to **approved partners only**; other API clients receive `403`
  (surfaced in the card UI). For most integrations, download individual models via
  `model_url` instead.
- Model files are downloaded via authenticated Bearer requests (see
  `T3KClient.downloadModel`). The web demo's in-app WASM preview player is omitted to keep
  the example focused.
- This example does not set a Content-Security-Policy; a production app should.
- Full API reference: [tone3000.com/api](https://www.tone3000.com/api).
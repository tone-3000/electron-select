import { useEffect, useState } from 'react'
import { PUBLISHABLE_KEY_SELECT, REDIRECT_URI, T3K_API } from '../config'
import { t3kClient } from '../client'
import { ToneCard } from '../components/ToneCard'
import { ModelList } from '../components/ModelList'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'
import type { Tone, Model } from '../types'
import type { SelectResult } from '../../../shared/types'
import t3kLogo from '../assets/t3k.svg'

type ToneWithModels = Tone & { models: Model[] }

export function SelectApp({ initial }: { initial: SelectResult }) {
  const [tone, setTone] = useState<ToneWithModels | null>(null)
  const [loading, setLoading] = useState(!!initial.toneId)
  const [error, setError] = useState<string | null>(
    initial.status === 'error' ? 'Authentication failed. Please try again.' : null
  )
  const [canceled, setCanceled] = useState(initial.status === 'canceled')
  const [connected, setConnected] = useState(t3kClient.isConnected())
  const [username, setUsername] = useState<string | null>(null)

  // Whenever connected, fetch the signed-in user with the stored token (no OAuth).
  // On boot this runs against tokens hydrated from safeStorage — the persistence
  // requirement made visible: "Signed in as @you" with no login.
  useEffect(() => {
    if (!connected) {
      setUsername(null)
      return
    }
    let cancelled = false
    t3kClient
      .getUser()
      .then((u) => { if (!cancelled) setUsername(u.username) })
      .catch(() => { if (!cancelled) { setConnected(false); setUsername(null) } })
    return () => { cancelled = true }
  }, [connected])

  // The select flow completed in the main process before this window reloaded.
  // Load whatever tone the app should display (the last selected one), with the
  // freshly persisted token — so a canceled re-browse still restores it.
  useEffect(() => {
    if (!initial.toneId) {
      setLoading(false)
      return
    }
    let cancelled = false
    Promise.all([
      t3kClient.getTone(initial.toneId),
      t3kClient.listModels(initial.toneId, { architecture: 2 }),
    ])
      .then(([t, modelsRes]) => { if (!cancelled) setTone({ ...t, models: modelsRes.data }) })
      .catch(() => { if (!cancelled) setError('Failed to load tone. Please try again.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [initial])

  // Hand off to TONE3000: the main process navigates this same window to the
  // authorize URL and reloads the app when the flow finishes. Nothing runs after
  // this call — the renderer is torn down.
  const handleBrowse = () => {
    void window.t3k.beginSelect({
      publishableKey: PUBLISHABLE_KEY_SELECT,
      redirectUri: REDIRECT_URI,
      apiDomain: T3K_API,
      options: { platform: 'nam', gears: 'full-rig', menubar: true, architecture: 2, calibrated: true },
    })
  }

  const handleDisconnect = () => {
    t3kClient.clearTokens()
    setConnected(false)
    setTone(null)
    setCanceled(false)
    setError(null)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <div className="app-logo-block">
            <span className="app-logo-icon">🎸</span>
            <span className="app-name">Acme Inc</span>
          </div>
          <span className="app-tagline">Guitar Amp Simulation · Electron</span>
        </div>
        {connected && (
          <div className="header-actions">
            <span className="badge badge--platform">
              {username ? `Signed in as @${username}` : 'Connected'}
            </span>
            <button className="btn btn-ghost btn-small" onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        )}
      </header>

      <main className="app-main">
        <div className="section-header">
          <h2 className="section-title">Tone Library</h2>
          {tone && (
            <button className="btn btn-secondary" onClick={handleBrowse}>
              Browse Different Tone
            </button>
          )}
        </div>

        {canceled && (
          <div className="info-banner">
            <span className="info-banner-icon">ℹ️</span>
            <p>You returned from TONE3000 without selecting a tone.</p>
          </div>
        )}

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {loading && (
          <div className="loading-state">
            <Spinner />
            <p>Loading tone from TONE3000…</p>
          </div>
        )}

        {!loading && !tone && (
          <div className="empty-state">
            <div className="empty-state-icon">🎛️</div>
            <h3 className="empty-state-title">No Tone Loaded</h3>
            <p className="empty-state-desc">
              {connected
                ? "You're connected — your session is saved and persists after you quit and relaunch. Browse the catalog to load a tone."
                : 'Browse the TONE3000 catalog to find a tone and load it into Acme Inc. You can download the model directly.'}
            </p>
            <button className="btn btn-primary btn-t3k" onClick={handleBrowse}>
              <img src={t3kLogo} alt="" className="btn-logo" />
              Browse Tones on TONE3000
            </button>
          </div>
        )}

        {tone && !loading && (
          <div className="tone-detail">
            <ToneCard tone={tone} />
            <div className="model-section">
              <h3 className="model-section-title">Models</h3>
              <ModelList models={tone.models} />
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <a
          href="https://www.tone3000.com/api"
          target="_blank"
          rel="noreferrer"
          className="back-link"
        >
          TONE3000 API docs ↗
        </a>
      </footer>
    </div>
  )
}

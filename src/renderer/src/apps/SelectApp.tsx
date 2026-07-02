import { useEffect, useState } from 'react'
import { PUBLISHABLE_KEY_SELECT, REDIRECT_URI } from '../config'
import { startSelectFlow } from '../tone3000-client'
import { t3kClient } from '../client'
import { ToneCard } from '../components/ToneCard'
import { ModelList } from '../components/ModelList'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'
import type { Tone, Model } from '../types'
import t3kLogo from '../assets/t3k.svg'

type ToneWithModels = Tone & { models: Model[] }

export function SelectApp() {
  const [tone, setTone] = useState<ToneWithModels | null>(null)
  const [loading, setLoading] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canceled, setCanceled] = useState(false)
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

  const loadTone = async (toneId: string) => {
    setLoading(true)
    try {
      const [t, modelsRes] = await Promise.all([
        t3kClient.getTone(toneId),
        t3kClient.listModels(toneId, { architecture: 2 }),
      ])
      setTone({ ...t, models: modelsRes.data })
    } catch {
      setError('Failed to load tone. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleBrowse = async () => {
    setError(null)
    setCanceled(false)
    setBrowsing(true)
    const result = await startSelectFlow(PUBLISHABLE_KEY_SELECT, REDIRECT_URI, {
      platform: 'nam',
      gears: 'full-rig',
      menubar: true,
      architecture: 2,
      calibrated: true,
    })
    setBrowsing(false)

    if (!result.ok) {
      if (result.error === 'canceled') setCanceled(true)
      else setError('Authentication failed. Please try again.')
      return
    }

    t3kClient.setTokens(result.tokens)
    setConnected(true)
    if (result.toneId) await loadTone(result.toneId)
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
            <p>You closed the tone browser without selecting a tone.</p>
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
            {browsing ? (
              <>
                <div className="empty-state-icon">🌐</div>
                <h3 className="empty-state-title">Signing in with TONE3000</h3>
                <p className="empty-state-desc">
                  Finish in the TONE3000 window to load a tone here.
                </p>
              </>
            ) : (
              <>
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
              </>
            )}
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

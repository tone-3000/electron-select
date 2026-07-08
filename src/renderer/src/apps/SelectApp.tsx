import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PUBLISHABLE_KEY_SELECT, REDIRECT_URI, T3K_API } from '../config'
import { t3kClient } from '../client'
import { ToneCard } from '../components/ToneCard'
import { ModelList } from '../components/ModelList'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'
import type { Tone, Model } from '../types'
import type { BeginSelectConfig, ViewBounds } from '../../../shared/types'
import t3kLogo from '../assets/t3k.svg'

type ToneWithModels = Tone & { models: Model[] }

const selectConfig: BeginSelectConfig = {
  publishableKey: PUBLISHABLE_KEY_SELECT,
  redirectUri: REDIRECT_URI,
  apiDomain: T3K_API,
  options: { platform: 'nam', gears: 'full-rig', menubar: true, architecture: 2, calibrated: true },
}

// The embedded TONE3000 view is positioned by the main process to cover this
// element exactly. getBoundingClientRect is relative to the renderer viewport,
// which is the window's content area — the same origin main's setBounds uses.
function measureBounds(el: HTMLElement): ViewBounds {
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  }
}

export function SelectApp() {
  const [tone, setTone] = useState<ToneWithModels | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canceled, setCanceled] = useState(false)
  const [connected, setConnected] = useState(t3kClient.isConnected())
  const [username, setUsername] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const slotRef = useRef<HTMLDivElement>(null)

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

  const loadTone = useCallback((toneId: string) => {
    setLoading(true)
    Promise.all([
      t3kClient.getTone(toneId),
      t3kClient.listModels(toneId, { architecture: 2 }),
    ])
      .then(([t, modelsRes]) => setTone({ ...t, models: modelsRes.data }))
      .catch(() => setError('Failed to load tone. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  // Hear the outcome pushed by main when it tears the embedded view down. This
  // is the single place `browsing` flips back to false — the view is already
  // gone in main by the time this fires, so the UI and the native view stay in
  // lockstep. Subscribed once; the returned fn unsubscribes on unmount.
  useEffect(() => {
    return window.t3k.onSelectComplete((result) => {
      setBrowsing(false)
      if (result.status === 'selected') {
        void t3kClient.hydrate().then(() => {
          setCanceled(false)
          setError(null)
          setConnected(true)
          if (result.toneId) loadTone(result.toneId)
        })
      } else if (result.status === 'canceled') {
        setCanceled(true)
      } else if (result.status === 'error') {
        setError('Authentication failed. Please try again.')
      }
    })
  }, [loadTone])

  // While browsing, drive the embedded view: start the flow at the slot's
  // measured bounds, then keep those bounds synced as the slot (or window)
  // resizes. main's beginSelect is idempotent — it destroys any prior view — so
  // StrictMode's double-invoked effect in dev just re-creates one view.
  useLayoutEffect(() => {
    if (!browsing) return
    const el = slotRef.current
    if (!el) return

    void window.t3k.beginSelect(selectConfig, measureBounds(el))

    const sync = (): void => window.t3k.setSelectBounds(measureBounds(el))
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [browsing])

  const handleBrowse = (): void => {
    setCanceled(false)
    setError(null)
    setBrowsing(true)
  }

  const handleDisconnect = (): void => {
    if (browsing) void window.t3k.endSelect()
    t3kClient.clearTokens()
    setConnected(false)
    setTone(null)
    setCanceled(false)
    setError(null)
  }

  return (
    <div className="app-shell app-shell--full">
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

      <div className="full-app-layout">
        <aside className="sidebar">
          <button className="sidebar-item sidebar-item--active">
            <span className="sidebar-icon">🎛️</span> TONE3000
          </button>
        </aside>

        <main className={`full-app-main${browsing ? ' full-app-main--embed' : ''}`}>
          {browsing ? (
            <div className="webview-slot" ref={slotRef} />
          ) : (
            <>
              <div className="section-header">
                <h2 className="section-title">TONE3000</h2>
                {tone && (
                  <button className="btn btn-secondary" onClick={handleBrowse}>
                    Browse Different Tone
                  </button>
                )}
              </div>

              {canceled && (
                <div className="info-banner">
                  <span className="info-banner-icon">ℹ️</span>
                  <p>You closed TONE3000 without selecting a tone.</p>
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
            </>
          )}
        </main>
      </div>

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

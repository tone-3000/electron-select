import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PUBLISHABLE_KEY_SELECT, REDIRECT_URI, T3K_API } from '../config'
import { t3kClient } from '../client'
import { ToneCard } from '../components/ToneCard'
import { ModelList } from '../components/ModelList'
import { RemoteToneList, clearToneListCache, type RemoteListKind } from '../components/RemoteToneList'
import { ApiError } from '../tone3000-client'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'
import { Format, type Tone, type Model } from '../types'
import type { BeginSelectConfig, ViewBounds } from '../../../shared/types'
import t3kLogo from '../assets/t3k.svg'

type ToneWithModels = Tone & { models: Model[] }
type EmbedMode = 'login' | 'select'
type Tab = 'loaded' | 'favorites' | 'created' | 'recents' | 'trending' | 'latest'

const baseConfig = {
  publishableKey: PUBLISHABLE_KEY_SELECT,
  redirectUri: REDIRECT_URI,
  apiDomain: T3K_API,
}

const loginConfig: BeginSelectConfig = { ...baseConfig }

// Unrestricted catalog; architecture: 2 so NAM tones have A2 models.
const selectConfig: BeginSelectConfig = {
  ...baseConfig,
  prompt: 'select_tone',
  options: { menubar: true, architecture: 2 },
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'loaded', label: 'Loaded on Acme' },
  { id: 'favorites', label: 'T3K Favorites' },
  { id: 'created', label: 'T3K Created' },
  { id: 'recents', label: 'T3K Recents' },
  { id: 'trending', label: 'T3K Trending' },
  { id: 'latest', label: 'T3K Latest' },
]

const TAB_TO_KIND: Record<Exclude<Tab, 'loaded'>, RemoteListKind> = {
  favorites: 'favorited',
  created: 'created',
  recents: 'downloaded',
  trending: 'trending',
  latest: 'latest',
}

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
  const [connected, setConnected] = useState(t3kClient.isConnected())
  const [username, setUsername] = useState<string | null>(null)
  const [embed, setEmbed] = useState<EmbedMode | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('loaded')
  const [loadedTones, setLoadedTones] = useState<ToneWithModels[]>([])
  const loadedTonesRef = useRef<ToneWithModels[]>([])
  loadedTonesRef.current = loadedTones
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loadingTone, setLoadingTone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canceled, setCanceled] = useState(false)
  const slotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!connected) {
      setUsername(null)
      return
    }
    let cancelled = false
    t3kClient
      .getUser()
      .then((u) => { if (!cancelled) setUsername(u.username) })
      .catch((err) => {
        if (cancelled) return
        // Don't log out on transient errors — only when tokens are gone.
        if (err instanceof ApiError && err.isRateLimit) return
        if (!t3kClient.isConnected()) {
          setConnected(false)
          setUsername(null)
        }
      })
    return () => { cancelled = true }
  }, [connected])

  // Fetch tone + models, prepend to loaded list. NAM tones get A2 models only.
  const loadTone = useCallback((toneId: string | number) => {
    setActiveTab('loaded')
    const existing = loadedTonesRef.current.find((x) => String(x.id) === String(toneId))
    if (existing) {
      setSelectedId(existing.id)
      return
    }
    setLoadingTone(true)
    t3kClient
      .getTone(toneId, { architecture: 2 })
      .then(async (t) => {
        const modelsRes = await t3kClient.listModels(
          toneId,
          t.format === Format.Nam ? { architecture: 2 } : undefined
        )
        const loaded: ToneWithModels = { ...t, models: modelsRes.data }
        setLoadedTones((prev) => [loaded, ...prev.filter((x) => x.id !== loaded.id)])
        setSelectedId(loaded.id)
      })
      .catch((err) =>
        setError(
          err instanceof ApiError && err.isRateLimit
            ? 'Too many requests — wait a moment and try again.'
            : 'Failed to load tone. Please try again.'
        )
      )
      .finally(() => setLoadingTone(false))
  }, [])

  useEffect(() => {
    return window.t3k.onSelectComplete((result) => {
      setEmbed(null)
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
        setError(
          result.error === 'authorize_failed_403' || result.error === 'authorize_failed_429'
            ? 'Too many requests — wait a moment and try again.'
            : 'Authentication failed. Please try again.'
        )
      }
    })
  }, [loadTone])

  // Position the embedded view over the slot and keep it synced on resize.
  useLayoutEffect(() => {
    if (!embed) return
    const el = slotRef.current
    if (!el) return

    void window.t3k.beginSelect(embed === 'select' ? selectConfig : loginConfig, measureBounds(el))

    const sync = (): void => window.t3k.setSelectBounds(measureBounds(el))
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [embed])

  const startEmbed = (mode: EmbedMode): void => {
    setCanceled(false)
    setError(null)
    setEmbed(mode)
  }

  const handleDisconnect = (): void => {
    if (embed) void window.t3k.endSelect()
    t3kClient.clearTokens()
    clearToneListCache()
    setConnected(false)
    setEmbed(null)
    setActiveTab('loaded')
    setLoadedTones([])
    setSelectedId(null)
    setCanceled(false)
    setError(null)
  }

  const selectedTone = loadedTones.find((t) => t.id === selectedId) ?? null

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

        <main className={`full-app-main${embed ? ' full-app-main--embed' : ''}`}>
          {embed ? (
            <div className="webview-slot" ref={slotRef} />
          ) : !connected ? (
            <div className="connect-state">
              <div className="welcome-brands">
                <span className="welcome-brand">🎸 Acme Inc</span>
                <span className="welcome-x">×</span>
                <span className="welcome-brand welcome-brand--t3k">
                  <img src={t3kLogo} alt="TONE3000" className="welcome-t3k-logo" />
                </span>
              </div>
              <h2 className="connect-state-title">Welcome to the Acme TONE3000 integration</h2>
              <p className="connect-state-desc">
                Connect your TONE3000 account to bring your tones into Acme Inc — load your
                favorites, your own captures, and recent downloads, or browse the full catalog
                and download models straight into the app.
              </p>

              {canceled && (
                <div className="info-banner">
                  <span className="info-banner-icon">ℹ️</span>
                  <p>You closed TONE3000 without signing in.</p>
                </div>
              )}
              {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

              <button className="btn btn-primary btn-large" onClick={() => startEmbed('login')}>
                Log into TONE3000
              </button>
            </div>
          ) : (
            <>
              <div className="section-header">
                <h2 className="section-title">TONE3000</h2>
                <button className="btn btn-primary" onClick={() => startEmbed('select')}>
                  Browse Tones on TONE3000
                </button>
              </div>

              {canceled && (
                <div className="info-banner">
                  <span className="info-banner-icon">ℹ️</span>
                  <p>You closed TONE3000 without selecting a tone.</p>
                </div>
              )}
              {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

              <div className="tab-bar">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    className={`tab${activeTab === tab.id ? ' tab--active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                    {tab.id === 'loaded' && loadedTones.length > 0 && ` (${loadedTones.length})`}
                  </button>
                ))}
              </div>

              {activeTab === 'loaded' ? (
                loadingTone ? (
                  <div className="loading-state">
                    <Spinner />
                    <p>Loading tone from TONE3000…</p>
                  </div>
                ) : loadedTones.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">🎛️</div>
                    <h3 className="empty-state-title">No Tones Loaded on Acme</h3>
                    <p className="empty-state-desc">
                      Browse the TONE3000 catalog, or pick from your Favorites, Created, and
                      Recents tabs to load a tone into Acme Inc.
                    </p>
                    <button className="btn btn-primary" onClick={() => startEmbed('select')}>
                      Browse Tones on TONE3000
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="tone-grid">
                      {loadedTones.map((t) => (
                        <div
                          key={t.id}
                          className={`tone-grid-item${t.id === selectedId ? ' tone-grid-item--active' : ''}`}
                        >
                          <ToneCard tone={t} compact onClick={() => setSelectedId(t.id)} />
                        </div>
                      ))}
                    </div>
                    {selectedTone && (
                      <div className="tone-detail loaded-detail">
                        <ToneCard tone={selectedTone} />
                        <div className="model-section">
                          <h3 className="model-section-title">Models</h3>
                          <ModelList models={selectedTone.models} />
                        </div>
                      </div>
                    )}
                  </>
                )
              ) : (
                <RemoteToneList
                  key={activeTab}
                  kind={TAB_TO_KIND[activeTab]}
                  onLoad={loadTone}
                />
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

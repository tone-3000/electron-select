import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Bookmark,
  Clock,
  Download,
  ExternalLink,
  Guitar,
  Info,
  type LucideIcon,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { PUBLISHABLE_KEY_SELECT, REDIRECT_URI, T3K_API } from '../config'
import { t3kClient } from '../client'
import { AcmeToneCard } from '../components/AcmeToneCard'
import { RemoteToneList, clearToneListCache, type RemoteListKind } from '../components/RemoteToneList'
import { ApiError } from '../tone3000-client'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'
import { Format, type Tone, type Model } from '../types'
import type { BeginSelectConfig, ViewBounds } from '../../../shared/types'
import t3kLogo from '../assets/t3k.svg'

type ToneWithModels = Tone & { models: Model[] }
type EmbedMode = 'login' | 'select'
type PrimaryView = 'acme' | 't3k'
type T3kPill = 'favorites' | 'recents' | 'trending' | 'downloads' | 'created'

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

const T3K_PILLS: { id: T3kPill; label: string; Icon: LucideIcon; kind: RemoteListKind }[] = [
  { id: 'trending', label: 'Trending', Icon: TrendingUp, kind: 'trending' },
  { id: 'favorites', label: 'Favorites', Icon: Bookmark, kind: 'favorited' },
  { id: 'recents', label: 'Latest', Icon: Clock, kind: 'latest' },
  { id: 'downloads', label: 'Downloads', Icon: Download, kind: 'downloaded' },
  { id: 'created', label: 'Created', Icon: Sparkles, kind: 'created' },
]

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
  const [primary, setPrimary] = useState<PrimaryView>('acme')
  const [t3kPill, setT3kPill] = useState<T3kPill>('trending')
  const [loadedTones, setLoadedTones] = useState<ToneWithModels[]>([])
  const loadedTonesRef = useRef<ToneWithModels[]>([])
  loadedTonesRef.current = loadedTones
  // Only the tone just added starts with models expanded.
  const [justAddedToneId, setJustAddedToneId] = useState<number | null>(null)
  const [loadingTone, setLoadingTone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canceled, setCanceled] = useState(false)
  const slotRef = useRef<HTMLDivElement>(null)

  const activePill = T3K_PILLS.find((p) => p.id === t3kPill) ?? T3K_PILLS[0]

  // Clear "just added" once the user leaves Acme so remounts stay collapsed.
  useEffect(() => {
    if (primary !== 'acme') setJustAddedToneId(null)
  }, [primary])

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
        if (err instanceof ApiError && err.isRateLimit) return
        if (!t3kClient.isConnected()) {
          setConnected(false)
          setUsername(null)
        }
      })
    return () => { cancelled = true }
  }, [connected])

  const fetchToneWithModels = useCallback(async (toneId: string | number): Promise<ToneWithModels> => {
    const t = await t3kClient.getTone(toneId, { architecture: 2 })
    const modelsRes = await t3kClient.listModels(
      toneId,
      t.format === Format.Nam
        ? { architecture: 2, pageSize: 100 }
        : { pageSize: 100 }
    )
    return { ...t, models: modelsRes.data }
  }, [])

  // Fetch tone + models, prepend to loaded list. NAM tones get A2 models only.
  const loadTone = useCallback((toneId: string | number) => {
    setPrimary('acme')
    const existing = loadedTonesRef.current.find((x) => String(x.id) === String(toneId))
    if (existing) {
      return
    }
    setLoadingTone(true)
    fetchToneWithModels(toneId)
      .then((loaded) => {
        setLoadedTones((prev) => [loaded, ...prev.filter((x) => x.id !== loaded.id)])
        setJustAddedToneId(loaded.id)
      })
      .catch((err) =>
        setError(
          err instanceof ApiError && err.isRateLimit
            ? 'Too many requests — wait a moment and try again.'
            : 'Failed to load tone. Please try again.'
        )
      )
      .finally(() => setLoadingTone(false))
  }, [fetchToneWithModels])

  const refreshTone = useCallback(async (toneId: number) => {
    try {
      const loaded = await fetchToneWithModels(toneId)
      setLoadedTones((prev) => prev.map((x) => (x.id === loaded.id ? loaded : x)))
      setError(null)
    } catch (err) {
      setError(
        err instanceof ApiError && err.isRateLimit
          ? 'Too many requests — wait a moment and try again.'
          : 'Failed to refresh tone. Please try again.'
      )
      throw err
    }
  }, [fetchToneWithModels])

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
    setPrimary('acme')
    setT3kPill('trending')
    setLoadedTones([])
    setJustAddedToneId(null)
    setCanceled(false)
    setError(null)
  }

  const browseCta = (
    <button className="btn btn-primary" onClick={() => startEmbed('select')}>
      <Search size={16} strokeWidth={2} />
      Browse Tones on TONE3000
    </button>
  )

  return (
    <div className="app-shell app-shell--full">
      <header className="app-header">
        <div className="app-brand">
          <div className="app-logo-block">
            <Guitar size={20} strokeWidth={2} className="app-logo-icon" />
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
            <SlidersHorizontal size={16} strokeWidth={2} className="sidebar-icon" />
            TONE3000
          </button>
        </aside>

        <main className={`full-app-main${embed ? ' full-app-main--embed' : ''}`}>
          {embed ? (
            <div className="webview-slot" ref={slotRef} />
          ) : !connected ? (
            <div className="connect-state">
              <div className="welcome-brands">
                <span className="welcome-brand">
                  <Guitar size={22} strokeWidth={2} /> Acme Inc
                </span>
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
                  <Info size={16} strokeWidth={2} className="info-banner-icon" />
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
              <div className="primary-tabs">
                <button
                  className={`primary-tab${primary === 'acme' ? ' primary-tab--active' : ''}`}
                  onClick={() => setPrimary('acme')}
                >
                  Tones on Acme
                </button>
                <button
                  className={`primary-tab${primary === 't3k' ? ' primary-tab--active' : ''}`}
                  onClick={() => setPrimary('t3k')}
                >
                  TONE3000 Tones
                </button>
              </div>

              {canceled && (
                <div className="info-banner">
                  <Info size={16} strokeWidth={2} className="info-banner-icon" />
                  <p>You closed TONE3000 without selecting a tone.</p>
                </div>
              )}
              {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

              {primary === 'acme' ? (
                <div className="content-panel">
                  <p className="panel-status">Loaded on this device · synced from T3K</p>

                  {loadingTone ? (
                    <div className="loading-state">
                      <Spinner />
                      <p>Loading tone from TONE3000…</p>
                    </div>
                  ) : loadedTones.length === 0 ? (
                    <div className="empty-state">
                      <SlidersHorizontal size={48} strokeWidth={1.5} className="empty-state-icon" />
                      <h3 className="empty-state-title">No tones loaded on Acme</h3>
                      <p className="empty-state-desc">
                        Loaded tones will appear here once synced.
                      </p>
                      <button className="btn btn-secondary" onClick={() => setPrimary('t3k')}>
                        Go to TONE3000 tones
                      </button>
                    </div>
                  ) : (
                    <div className="acme-tone-stack">
                      {loadedTones.map((t) => (
                        <AcmeToneCard
                          key={t.id}
                          tone={t}
                          defaultExpanded={t.id === justAddedToneId}
                          onRefresh={refreshTone}
                          onRemove={(id) => {
                            setLoadedTones((prev) => prev.filter((x) => x.id !== id))
                            setJustAddedToneId((cur) => (cur === id ? null : cur))
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="content-panel">
                  <div className="stream-tabs-row">
                    <div className="stream-tabs">
                      {T3K_PILLS.map((pill) => (
                        <button
                          key={pill.id}
                          className={`stream-tab${t3kPill === pill.id ? ' stream-tab--active' : ''}`}
                          onClick={() => setT3kPill(pill.id)}
                        >
                          <pill.Icon size={14} strokeWidth={2} />
                          {pill.label}
                        </button>
                      ))}
                    </div>
                    {browseCta}
                  </div>

                  <h3 className="list-section-title">
                    <activePill.Icon size={16} strokeWidth={2} className="list-section-icon" />
                    {activePill.label}
                  </h3>

                  <RemoteToneList
                    key={t3kPill}
                    kind={activePill.kind}
                    onLoad={loadTone}
                  />
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
          TONE3000 API docs <ExternalLink size={12} strokeWidth={2} />
        </a>
      </footer>
    </div>
  )
}

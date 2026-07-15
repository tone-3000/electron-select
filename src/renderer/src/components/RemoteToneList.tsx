// Paginated user lists + homepage feeds (trending / latest).
// Refetches on each tab / page / gear load. Trending has gear-type pills.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, SlidersHorizontal } from 'lucide-react'
import { t3kClient } from '../client'
import { ApiError } from '../tone3000-client'
import { ToneCard } from './ToneCard'
import { Spinner } from './Spinner'
import { Gear, type Tone } from '../types'

export type RemoteListKind = 'favorited' | 'created' | 'downloaded' | 'trending' | 'latest'

type ToneListResult = { data: Tone[]; page?: number; total_pages?: number }

const PAGE_SIZE = 12
const DEFAULT_GEAR = Gear.AmpCab

const GEAR_PILLS: { id: Gear; label: string }[] = [
  { id: Gear.AmpCab, label: 'Amp + Cab' },
  { id: Gear.Amp, label: 'Amp' },
  { id: Gear.Pedal, label: 'Pedal' },
  { id: Gear.Cab, label: 'Cab' },
  { id: Gear.Outboard, label: 'Outboard' },
  { id: Gear.Space, label: 'Space' },
  { id: Gear.Experimental, label: 'Experimental' },
]

const EMPTY_COPY: Record<RemoteListKind, { title: string; desc: string }> = {
  favorited: {
    title: 'No favorites yet',
    desc: 'Tones you favorite on TONE3000 will show up here, ready to load into Acme Inc.',
  },
  created: {
    title: 'No created tones',
    desc: "Tones you upload to TONE3000 will show up here, ready to load into Acme Inc.",
  },
  downloaded: {
    title: 'No recent downloads',
    desc: 'Tones you download on TONE3000 will show up here, ready to load into Acme Inc.',
  },
  trending: {
    title: 'Nothing trending',
    desc: 'No trending tones for this gear type right now. Try another gear type.',
  },
  latest: {
    title: 'No new tones',
    desc: 'No recently published tones right now. Check back soon.',
  },
}

function fetchKind(kind: RemoteListKind, page: number, gear: Gear): Promise<ToneListResult> {
  switch (kind) {
    case 'favorited':
      return t3kClient.listFavoritedTones({ page, pageSize: PAGE_SIZE })
    case 'created':
      return t3kClient.listCreatedTones({ page, pageSize: PAGE_SIZE })
    case 'downloaded':
      return t3kClient.listDownloadedTones({ page, pageSize: PAGE_SIZE })
    case 'trending':
      return t3kClient.listTrendingTones(gear)
    case 'latest':
      return t3kClient.listLatestTones()
  }
}

/** No-op kept for disconnect cleanup callers. */
export function clearToneListCache(): void {
  // Lists are not cached across tab loads; nothing to clear.
}

interface Props {
  kind: RemoteListKind
  onLoad: (toneId: number) => void
}

export function RemoteToneList({ kind, onLoad }: Props) {
  const [page, setPage] = useState(1)
  const [gear, setGear] = useState<Gear>(DEFAULT_GEAR)
  const [result, setResult] = useState<ToneListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  const fetchPage = useCallback(
    (p: number): (() => void) => {
      let cancelled = false
      setLoading(true)
      setError(null)
      fetchKind(kind, p, gear)
        .then((res) => {
          if (!cancelled) setResult(res)
        })
        .catch((err) => {
          if (cancelled) return
          setError(
            err instanceof ApiError && err.isRateLimit
              ? 'Too many requests — wait a moment and try again.'
              : 'Failed to load tones from TONE3000. Please try again.'
          )
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return () => {
        cancelled = true
      }
    },
    [kind, gear]
  )

  useEffect(() => fetchPage(page), [fetchPage, page, retryKey])

  const gearPills = kind === 'trending' && (
    <div className="gear-pills">
      {GEAR_PILLS.map((g) => (
        <button
          key={g.id}
          className={`gear-pill${gear === g.id ? ' gear-pill--active' : ''}`}
          onClick={() => {
            setPage(1)
            setGear(g.id)
          }}
        >
          {g.label}
        </button>
      ))}
    </div>
  )

  if (loading) {
    return (
      <>
        {gearPills}
        <div className="loading-state">
          <Spinner />
          <p>Loading tones from TONE3000…</p>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        {gearPills}
        <div className="empty-state">
          <AlertTriangle size={48} strokeWidth={1.5} className="empty-state-icon" />
          <p className="empty-state-desc">{error}</p>
          <button className="btn btn-secondary" onClick={() => setRetryKey((k) => k + 1)}>
            Try again
          </button>
        </div>
      </>
    )
  }

  if (!result || result.data.length === 0) {
    const copy = EMPTY_COPY[kind]
    return (
      <>
        {gearPills}
        <div className="empty-state">
          <SlidersHorizontal size={48} strokeWidth={1.5} className="empty-state-icon" />
          <h3 className="empty-state-title">{copy.title}</h3>
          <p className="empty-state-desc">{copy.desc}</p>
        </div>
      </>
    )
  }

  return (
    <>
      {gearPills}
      <p className="load-hint">Click + to load a tone onto Acme.</p>
      <div className="tone-grid">
        {result.data.map((tone) => (
          <ToneCard key={tone.id} tone={tone} compact onAdd={() => onLoad(tone.id)} />
        ))}
      </div>
      {result.total_pages != null && result.total_pages > 1 && (
        <div className="pagination">
          <button
            className="btn btn-secondary btn-small"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            ← Prev
          </button>
          <span className="pagination-info">
            Page {result.page} of {result.total_pages}
          </span>
          <button
            className="btn btn-secondary btn-small"
            disabled={page >= result.total_pages}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </>
  )
}

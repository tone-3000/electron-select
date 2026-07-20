import { useState } from 'react'
import { ChevronDown, FolderArchive, RefreshCw, Trash2 } from 'lucide-react'
import type { Model, Tone, ArchitectureVersion } from '../types'
import { CrossOriginImage } from './CrossOriginImage'
import { t3kClient } from '../client'
import { ApiError } from '../tone3000-client'

const FORMAT_LABELS: Record<string, string> = {
  'nam': 'NAM', 'ir': 'IR', 'aida-x': 'AIDA-X',
  'aa-snapshot': 'Snapshot', 'proteus': 'Proteus',
}

const GEAR_LABELS: Record<string, string> = {
  'amp': 'Amp', 'amp-cab': 'Amp + Cab', 'full-rig': 'Full Rig', 'pedal': 'Pedal',
  'outboard': 'Outboard', 'cab': 'Cab', 'space': 'Space', 'experimental': 'Experimental',
  'ir': 'IR',
}

const ARCHITECTURE_LABELS: Record<ArchitectureVersion, string> = {
  '1': 'A1', '2': 'A2', 'custom': 'Custom',
}

const PAGE_SIZE = 10
const AUTO_LOAD_COUNT = 5

type ToneWithModels = Tone & { models: Model[] }

interface Props {
  tone: ToneWithModels
  /** When true, models start expanded (used for a tone that was just added). */
  defaultExpanded?: boolean
  onRefresh: (toneId: number) => Promise<void>
  onRemove: (toneId: number) => void
}

export function AcmeToneCard({ tone, defaultExpanded = false, onRefresh, onRemove }: Props) {
  const [modelsOpen, setModelsOpen] = useState(defaultExpanded)
  const [page, setPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const [loadedIds, setLoadedIds] = useState<Set<number>>(
    () => new Set(tone.models.slice(0, AUTO_LOAD_COUNT).map((m) => m.id))
  )
  const [busyIds, setBusyIds] = useState<Set<number>>(() => new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [zipping, setZipping] = useState(false)
  const [zipError, setZipError] = useState<string | null>(null)

  // First 5 models start as "Loaded". In a real product you'd auto-download
  // those files here (e.g. t3kClient.downloadModel for each).

  // Download every model in the tone as one .zip via GET /tones/{id}/download.
  // The URL it returns is temporary (expires in 1h), so we request it fresh on
  // every click. Note: this endpoint is limited to approved partners — other
  // API clients receive 403.
  const handleDownloadZip = (): void => {
    if (zipping) return
    setZipping(true)
    setZipError(null)
    void t3kClient.downloadToneZip(tone.id)
      .catch((err) => {
        console.error('Zip download failed:', err)
        if (err instanceof ApiError && err.status === 403) {
          setZipError('Zip downloads are available to approved partners only')
        } else if (err instanceof ApiError && err.status === 400) {
          setZipError('This tone has no downloadable models')
        } else {
          setZipError(err instanceof Error ? `Zip download failed — ${err.message}` : 'Zip download failed')
        }
      })
      .finally(() => setZipping(false))
  }

  const handleRefresh = (): void => {
    if (refreshing) return
    setRefreshing(true)
    void onRefresh(tone.id)
      .catch(() => { /* parent surfaces error */ })
      .finally(() => setRefreshing(false))
  }

  const handleToggle = (model: Model, on: boolean): void => {
    if (!on) {
      setLoadedIds((prev) => {
        const next = new Set(prev)
        next.delete(model.id)
        return next
      })
      return
    }

    setLoadedIds((prev) => new Set(prev).add(model.id))
    setBusyIds((prev) => new Set(prev).add(model.id))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[model.id]
      return next
    })
    void t3kClient.downloadModel(model.model_url, model.name)
      .catch(() => {
        setErrors((prev) => ({ ...prev, [model.id]: 'Download failed' }))
        setLoadedIds((prev) => {
          const next = new Set(prev)
          next.delete(model.id)
          return next
        })
      })
      .finally(() => {
        setBusyIds((prev) => {
          const next = new Set(prev)
          next.delete(model.id)
          return next
        })
      })
  }

  const totalPages = Math.max(1, Math.ceil(tone.models.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = tone.models.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <article className="acme-tone-card">
      <div className="acme-tone-card-top">
        {tone.images?.[0] ? (
          <CrossOriginImage
            src={tone.images[0]}
            alt={tone.title}
            className="acme-tone-card-image"
          />
        ) : (
          <div className="acme-tone-card-image acme-tone-card-image--empty" />
        )}
        <div className="acme-tone-card-meta">
          <div className="acme-tone-card-meta-header">
            <h3 className="acme-tone-card-title">{tone.title}</h3>
            <div className="acme-tone-card-actions">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={handleDownloadZip}
                disabled={zipping}
                aria-label={`Download all models of ${tone.title} as a zip archive`}
                title="Download all models as .zip"
              >
                <FolderArchive size={14} strokeWidth={2} />
                {zipping ? 'Zipping…' : 'Download .zip'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label={`Refresh ${tone.title} from TONE3000`}
                title="Refresh from TONE3000"
              >
                <RefreshCw
                  size={14}
                  strokeWidth={2}
                  className={refreshing ? 'acme-tone-refresh-spin' : undefined}
                />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small acme-tone-remove"
                onClick={() => onRemove(tone.id)}
                disabled={refreshing}
                aria-label={`Remove ${tone.title} from Acme`}
                title="Remove from Acme"
              >
                <Trash2 size={14} strokeWidth={2} />
                Remove
              </button>
            </div>
          </div>
          <p className="acme-tone-card-creator">by @{tone.user.username}</p>
          {zipError && <p className="model-row-error">{zipError}</p>}
          <div className="tone-card-badges">
            <span className="badge badge--platform">{FORMAT_LABELS[tone.format] ?? tone.format}</span>
            <span className="badge badge--gear">{GEAR_LABELS[tone.gear] ?? tone.gear}</span>
            {!tone.is_public && <span className="badge badge--private">Private</span>}
            {tone.tags?.slice(0, 4).map((tag) => (
              <span key={tag.id ?? tag.name} className="badge">{tag.name}</span>
            ))}
          </div>
        </div>
      </div>

      <hr className="acme-tone-card-sep" />

      <button
        type="button"
        className="acme-models-toggle"
        onClick={() => setModelsOpen((open) => !open)}
        aria-expanded={modelsOpen}
      >
        <span>Models ({tone.models.length})</span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={`acme-models-chevron${modelsOpen ? ' acme-models-chevron--open' : ''}`}
        />
      </button>

      {modelsOpen && (
        tone.models.length === 0 ? (
          <p className="empty-list">No models available for this tone.</p>
        ) : (
          <div className="acme-model-list">
            {visible.map((model) => {
              const loaded = loadedIds.has(model.id)
              const busy = busyIds.has(model.id)
              return (
                <div key={model.id} className="acme-model-row">
                  <div className="acme-model-row-info">
                    <span className="acme-model-row-name">{model.name}</span>
                    {model.architecture_version && (
                      <span className="badge">
                        {ARCHITECTURE_LABELS[model.architecture_version] ?? model.architecture_version}
                      </span>
                    )}
                    {errors[model.id] && (
                      <span className="model-row-error">{errors[model.id]}</span>
                    )}
                  </div>
                  <label className={`loaded-toggle${busy ? ' loaded-toggle--busy' : ''}`}>
                    <span className="loaded-toggle-label">{busy ? 'Loading…' : 'Loaded'}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={loaded}
                      disabled={busy}
                      onChange={(e) => handleToggle(model, e.target.checked)}
                    />
                    <span className="loaded-toggle-track" aria-hidden />
                  </label>
                </div>
              )
            })}
            {totalPages > 1 && (
              <div className="pagination">
                <button
                  className="btn btn-secondary btn-small"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                >
                  ← Prev
                </button>
                <span className="pagination-info">
                  Page {safePage} of {totalPages}
                </span>
                <button
                  className="btn btn-secondary btn-small"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )
      )}
    </article>
  )
}

import { useState } from 'react'
import type { Model, ArchitectureVersion } from '../types'
import { t3kClient } from '../client'

interface Props {
  models: Model[]
}

const ARCHITECTURE_LABELS: Record<ArchitectureVersion, string> = {
  '1': 'A1', '2': 'A2', 'custom': 'Custom',
}

function ModelRow({ model }: { model: Model }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDownload = async () => {
    setDownloading(true)
    setError(null)
    try {
      // Bearer-authenticated fetch of the model file → Electron download manager.
      await t3kClient.downloadModel(model.model_url, model.name)
    } catch {
      setError('Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="model-row">
      <div className="model-row-info">
        <span className="model-row-name">{model.name}</span>
        <span className="badge">
          {ARCHITECTURE_LABELS[model.architecture_version] ?? model.architecture_version}
        </span>
      </div>
      <div className="model-row-actions">
        {error && <span className="model-row-error">{error}</span>}
        <button
          className="btn btn-secondary btn-small"
          onClick={handleDownload}
          disabled={downloading}
        >
          {downloading ? 'Downloading…' : 'Download'}
        </button>
      </div>
    </div>
  )
}

export function ModelList({ models }: Props) {
  if (models.length === 0) {
    return <p className="empty-list">No models available for this tone.</p>
  }

  return (
    <div className="model-list">
      {models.map((model) => (
        <ModelRow key={model.id} model={model} />
      ))}
    </div>
  )
}

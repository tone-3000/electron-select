import { useEffect, useState } from 'react'
import { t3kClient } from './client'
import { SelectApp } from './apps/SelectApp'
import type { SelectResult } from '../../shared/types'

export default function App() {
  const [initial, setInitial] = useState<SelectResult | null>(null)

  // Before first render, hydrate persisted tokens (so the app comes up already
  // connected) and read any pending select-flow result the main process left
  // after navigating the window back from TONE3000. Both reads are idempotent,
  // so StrictMode's double-invoked effect in dev is harmless.
  useEffect(() => {
    let alive = true
    void Promise.all([t3kClient.hydrate(), window.t3k.getSelectResult()]).then(([, result]) => {
      if (alive) setInitial(result)
    })
    return () => { alive = false }
  }, [])

  if (!initial) {
    return (
      <div className="splash">
        <div className="splash-spinner" />
        <p className="splash-text">Starting…</p>
      </div>
    )
  }

  return <SelectApp initial={initial} />
}

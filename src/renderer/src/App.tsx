import { useEffect, useState } from 'react'
import { t3kClient } from './client'
import { SelectApp } from './apps/SelectApp'

export default function App() {
  const [ready, setReady] = useState(false)

  // Hydrate persisted tokens before first render so the app comes up already
  // connected (safeStorage → memory). The select flow now runs in an embedded
  // view without tearing this renderer down, so there's no post-reload result to
  // read here — SelectApp subscribes to the outcome via window.t3k.onSelectComplete.
  useEffect(() => {
    let alive = true
    void t3kClient.hydrate().then(() => {
      if (alive) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-spinner" />
        <p className="splash-text">Starting…</p>
      </div>
    )
  }

  return <SelectApp />
}

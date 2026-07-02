import { useEffect, useState } from 'react'
import { t3kClient } from './client'
import { SelectApp } from './apps/SelectApp'

export default function App() {
  const [ready, setReady] = useState(false)

  // Hydrate persisted tokens before first render so the app comes up already
  // connected when the user has authed in a previous session.
  useEffect(() => {
    t3kClient.hydrate().finally(() => setReady(true))
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

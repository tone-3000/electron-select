import { useEffect, useState } from 'react'
import { t3kClient } from './client'
import { SelectApp } from './apps/SelectApp'

export default function App() {
  const [ready, setReady] = useState(false)

  // Hydrate tokens from safeStorage before first render.
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

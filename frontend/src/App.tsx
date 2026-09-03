import { useCallback, useEffect, useState } from 'react'
import { createUser, deleteUser, fetchGreeting, listUsers } from './api'
import { UserCard } from './UserCard'
import type { HitResult, UserBucket } from './types'
import './App.css'

const LOG_LIMIT = 10

function App() {
  const [users, setUsers] = useState<UserBucket[]>([])
  const [maxUsers, setMaxUsers] = useState(10)
  const [logs, setLogs] = useState<Record<string, HitResult[]>>({})
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const data = await listUsers()
    setUsers(data.users)
    setMaxUsers(data.maxUsers)
    setError(null)
  }, [])

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message))
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function handleAdd() {
    setError(null)
    try {
      await createUser()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add user')
    }
  }

  async function handleRemove(id: string) {
    setError(null)
    try {
      await deleteUser(id)
      setLogs((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user')
    }
  }

  async function handleHit(id: string, count: number) {
    setBusyIds((current) => ({ ...current, [id]: true }))
    setError(null)
    try {
      const results = await Promise.all(
        Array.from({ length: count }, () => fetchGreeting(id)),
      )
      setLogs((current) => {
        const newest = results.slice(-LOG_LIMIT).reverse()
        return {
          ...current,
          [id]: [...newest, ...(current[id] ?? [])].slice(0, LOG_LIMIT),
        }
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusyIds((current) => ({ ...current, [id]: false }))
    }
  }

  const atCap = users.length >= maxUsers

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Token bucket</p>
        <h1>Rate limiter demo</h1>
        <p className="lede">
          Each user starts with 100 tokens and refills to full in 60 seconds
          (~1.67 tokens/sec). Burst buttons call a real greeting endpoint; a
          rate-limit guard checks an in-memory cache (stand-in for Redis) before
          the handler touches the DB. An empty bucket returns 429; other
          failures keep their own status (for example 404).
        </p>
        <div className="toolbar">
          <button type="button" className="primary" onClick={handleAdd} disabled={atCap}>
            Add user
          </button>
          <span className="count">
            {users.length} / {maxUsers} users
          </span>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </header>

      {users.length === 0 ? (
        <p className="empty">Add a user to start firing requests.</p>
      ) : (
        <section className="grid">
          {users.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              logs={logs[user.id] ?? []}
              busy={Boolean(busyIds[user.id])}
              onHit={(count) => void handleHit(user.id, count)}
              onRemove={() => void handleRemove(user.id)}
            />
          ))}
        </section>
      )}
    </div>
  )
}

export default App

import type { HitResult, UserBucket } from './types'

interface UserCardProps {
  user: UserBucket
  logs: HitResult[]
  busy: boolean
  onHit: (count: number) => void
  onRemove: () => void
}

const BURSTS = [1, 3, 5, 10, 50]

function tankColor(ratio: number): string {
  if (ratio < 0.2) return 'low'
  if (ratio < 0.5) return 'mid'
  return 'high'
}

function formatRemaining(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2)
}

function logClass(status: number): string {
  if (status === 200) return 'ok'
  if (status === 429) return 'denied'
  return 'other'
}

function logLabel(entry: HitResult): string {
  if (entry.status === 200) return entry.message ?? 'ok'
  if (entry.status === 429) return 'rate limited'
  return entry.message ?? 'error'
}

export function UserCard({ user, logs, busy, onHit, onRemove }: UserCardProps) {
  const ratio = Math.max(0, Math.min(1, user.remaining / user.capacity))
  const level = tankColor(ratio)

  return (
    <article className="user-card">
      <header className="user-card-header">
        <h2>{user.name}</h2>
        <button type="button" className="ghost" onClick={onRemove}>
          Remove
        </button>
      </header>

      <div className="tank-row">
        <div className={`tank ${level}`} aria-hidden="true">
          <div className="tank-fill" style={{ height: `${ratio * 100}%` }}>
            <div className="tank-shine" />
          </div>
        </div>
        <div className="tank-meta">
          <p className="remaining">
            <strong>{formatRemaining(user.remaining)}</strong>
            <span> / {user.capacity}</span>
          </p>
          <p className="hint">tokens left</p>
          <p className="hint">
            Refills {user.refillPerSecond.toFixed(2)} / sec
          </p>
        </div>
      </div>

      <div className="burst-row">
        {BURSTS.map((count) => (
          <button
            key={count}
            type="button"
            className="burst"
            disabled={busy}
            onClick={() => onHit(count)}
          >
            {count} {count === 1 ? 'request' : 'requests'}
          </button>
        ))}
      </div>

      <ul className="log">
        {logs.length === 0 ? (
          <li className="log-empty">No requests yet</li>
        ) : (
          logs.map((entry, index) => (
            <li
              key={`${entry.at}-${index}`}
              className={logClass(entry.status)}
            >
              <span>{entry.status}</span>
              <span>{logLabel(entry)}</span>
              <span>{formatRemaining(entry.remaining)} left</span>
            </li>
          ))
        )}
      </ul>
    </article>
  )
}

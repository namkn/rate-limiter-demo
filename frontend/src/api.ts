import type { HitResult, UserBucket, UsersResponse } from './types'

function readMessage(body: { message?: unknown }): string | undefined {
  if (typeof body.message === 'string') {
    return body.message
  }
  if (Array.isArray(body.message)) {
    return body.message.join(', ')
  }
  return undefined
}

export async function listUsers(): Promise<UsersResponse> {
  const res = await fetch('/api/users')
  if (!res.ok) {
    throw new Error('Failed to load users')
  }
  return res.json()
}

export async function createUser(): Promise<UserBucket> {
  const res = await fetch('/api/users', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(readMessage(body) ?? 'Failed to create user')
  }
  return body
}

export async function deleteUser(id: string): Promise<void> {
  const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    throw new Error('Failed to remove user')
  }
}

export async function fetchGreeting(id: string): Promise<HitResult> {
  const at = Date.now()
  const res = await fetch(`/api/users/${id}/greeting`)
  const body = await res.json().catch(() => ({}))
  const remaining = Number(
    res.headers.get('x-ratelimit-remaining') ?? body.remaining ?? 0,
  )
  const capacity = Number(
    res.headers.get('x-ratelimit-limit') ?? body.capacity ?? 100,
  )

  return {
    allowed: res.status === 200,
    remaining,
    capacity,
    retryAfterMs: body.retryAfterMs,
    status: res.status,
    message: readMessage(body),
    at,
  }
}

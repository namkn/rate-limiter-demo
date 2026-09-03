import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUser, deleteUser, fetchGreeting, listUsers } from './api'

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('listUsers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws a generic error on a failed list so a 500 body cannot look like a user payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(500, { message: 'Internal server error' }),
      ),
    )

    await expect(listUsers()).rejects.toThrow('Failed to load users')
  })
})

describe('createUser', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces Nest string messages so a 409 at cap is readable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          statusCode: 409,
          message: 'Maximum of 10 users reached',
          error: 'Conflict',
        }),
      ),
    )

    await expect(createUser()).rejects.toThrow('Maximum of 10 users reached')
  })

  it('joins Nest array messages instead of showing [object Object] or dropping the error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, { message: ['name must be a string', 'id is required'] }),
      ),
    )

    await expect(createUser()).rejects.toThrow(
      'name must be a string, id is required',
    )
  })

  it('falls back when the error body is empty or not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    )

    await expect(createUser()).rejects.toThrow('Failed to create user')
  })
})

describe('deleteUser', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats 204 as success even though the body is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    )

    await expect(deleteUser('1')).resolves.toBeUndefined()
  })

  it('throws when deleting a missing user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { message: 'User 99 not found' })),
    )

    await expect(deleteUser('99')).rejects.toThrow('Failed to remove user')
  })
})

describe('fetchGreeting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks only HTTP 200 as allowed so a 429 body with a message is not treated as a greeting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          429,
          {
            message: 'Too many requests',
            allowed: false,
            remaining: 0,
            capacity: 100,
            retryAfterMs: 600,
          },
          {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '0',
            'Retry-After': '1',
          },
        ),
      ),
    )

    await expect(fetchGreeting('1')).resolves.toMatchObject({
      allowed: false,
      status: 429,
      remaining: 0,
      capacity: 100,
      retryAfterMs: 600,
      message: 'Too many requests',
    })
  })

  it('returns a 404 hit instead of throwing so a burst of greetings is not aborted by one missing user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(404, { message: 'User missing not found' }),
      ),
    )

    await expect(fetchGreeting('missing')).resolves.toMatchObject({
      allowed: false,
      status: 404,
      message: 'User missing not found',
    })
  })

  it('prefers rate-limit headers over body so a 200 greeting without remaining in JSON still shows the tank', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          200,
          { message: 'Hello from User 1.', userId: '1', servedAt: '2023-01-01T00:00:00.000Z' },
          {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
          },
        ),
      ),
    )

    await expect(fetchGreeting('1')).resolves.toMatchObject({
      allowed: true,
      status: 200,
      remaining: 99,
      capacity: 100,
      message: 'Hello from User 1.',
    })
  })

  it('does not treat a remaining header of 0 as missing and fall back to a stale body value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          429,
          { message: 'Too many requests', remaining: 50, capacity: 100 },
          {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Limit': '100',
          },
        ),
      ),
    )

    const hit = await fetchGreeting('1')
    expect(hit.remaining).toBe(0)
    expect(hit.allowed).toBe(false)
  })

  it('reads remaining from the 429 body when CORS hides the rate-limit headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(429, {
          message: 'Too many requests',
          remaining: 0.4,
          capacity: 100,
          retryAfterMs: 360,
        }),
      ),
    )

    await expect(fetchGreeting('1')).resolves.toMatchObject({
      remaining: 0.4,
      capacity: 100,
      retryAfterMs: 360,
      allowed: false,
    })
  })

  it('does not reject when a 429 has an empty body, so Promise.all bursts still settle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 429 })),
    )

    await expect(fetchGreeting('1')).resolves.toMatchObject({
      allowed: false,
      status: 429,
      remaining: 0,
      capacity: 100,
    })
  })
})

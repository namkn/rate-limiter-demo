import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createUser, deleteUser, fetchGreeting, listUsers } from './api'
import type { HitResult, UserBucket } from './types'

vi.mock('./api', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  fetchGreeting: vi.fn(),
}))

function bucket(
  id: string,
  name: string,
  remaining = 100,
): UserBucket {
  return {
    id,
    name,
    remaining,
    capacity: 100,
    refillPerSecond: 1.6667,
    windowMs: 60_000,
  }
}

function greetingHit(message: string, remaining: number, at: number): HitResult {
  return {
    allowed: true,
    status: 200,
    remaining,
    capacity: 100,
    message,
    at,
  }
}

function limitedHit(at: number): HitResult {
  return {
    allowed: false,
    status: 429,
    remaining: 0,
    capacity: 100,
    message: 'Too many requests',
    retryAfterMs: 600,
    at,
  }
}

function cardNamed(name: string) {
  return screen.getByRole('heading', { name }).closest('article') as HTMLElement
}

describe('App', () => {
  beforeEach(() => {
    vi.mocked(listUsers).mockResolvedValue({ users: [], maxUsers: 10 })
    vi.mocked(createUser).mockReset()
    vi.mocked(deleteUser).mockReset()
    vi.mocked(fetchGreeting).mockReset()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows the initial list failure instead of an empty dashboard that looks unused', async () => {
    vi.mocked(listUsers).mockRejectedValue(new Error('Failed to load users'))

    render(<App />)

    expect(await screen.findByText('Failed to load users')).toBeInTheDocument()
    expect(
      screen.getByText('Add a user to start firing requests.'),
    ).toBeInTheDocument()
  })

  it('does not clear cards or flash an error when a later poll fails', async () => {
    const user = bucket('1', 'User 1', 80)
    vi.mocked(listUsers)
      .mockResolvedValueOnce({ users: [user], maxUsers: 10 })
      .mockRejectedValueOnce(new Error('Failed to load users'))

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'User 1' })).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(1000)

    expect(screen.getByRole('heading', { name: 'User 1' })).toBeInTheDocument()
    expect(screen.queryByText('Failed to load users')).not.toBeInTheDocument()
  })

  it('disables Add user at the backend cap so a 409 is not the only guard', async () => {
    vi.mocked(listUsers).mockResolvedValue({
      users: Array.from({ length: 10 }, (_, i) =>
        bucket(String(i + 1), `User ${i + 1}`),
      ),
      maxUsers: 10,
    })

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'User 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled()
  })

  it('shows the backend cap message when create still fails', async () => {
    const events = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(createUser).mockRejectedValue(
      new Error('Maximum of 10 users reached'),
    )

    render(<App />)
    await screen.findByText('Add a user to start firing requests.')
    await events.click(screen.getByRole('button', { name: 'Add user' }))

    expect(
      await screen.findByText('Maximum of 10 users reached'),
    ).toBeInTheDocument()
  })

  it('keeps only the last 10 hits, newest first, after a 50-request burst', async () => {
    const events = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const user = bucket('1', 'User 1')
    vi.mocked(listUsers).mockResolvedValue({ users: [user], maxUsers: 10 })

    let n = 0
    vi.mocked(fetchGreeting).mockImplementation(async () => {
      n += 1
      if (n <= 40) {
        return greetingHit(`Hello ${n}`, 100 - n, n)
      }
      return limitedHit(n)
    })

    render(<App />)
    await screen.findByRole('heading', { name: 'User 1' })
    await events.click(
      within(cardNamed('User 1')).getByRole('button', { name: '50 requests' }),
    )

    await waitFor(() => {
      const items = within(cardNamed('User 1')).getAllByRole('listitem')
      expect(items).toHaveLength(10)
    })

    const items = within(cardNamed('User 1')).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('429')
    expect(items[0]).toHaveTextContent('rate limited')
    expect(items[9]).toHaveTextContent('429')
    expect(within(cardNamed('User 1')).queryByText(/Hello /)).not.toBeInTheDocument()
  })

  it('drops the oldest logs when a new burst exceeds the 10-row cap', async () => {
    const events = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const user = bucket('1', 'User 1')
    vi.mocked(listUsers).mockResolvedValue({ users: [user], maxUsers: 10 })

    let n = 0
    vi.mocked(fetchGreeting).mockImplementation(async () => {
      n += 1
      return greetingHit(`Hello ${n}`, 99, n)
    })

    render(<App />)
    await screen.findByRole('heading', { name: 'User 1' })

    await events.click(
      within(cardNamed('User 1')).getByRole('button', { name: '5 requests' }),
    )
    await screen.findByText('Hello 5')

    await events.click(
      within(cardNamed('User 1')).getByRole('button', { name: '10 requests' }),
    )
    await waitFor(() => {
      expect(screen.getByText('Hello 15')).toBeInTheDocument()
    })

    const items = within(cardNamed('User 1')).getAllByRole('listitem')
    expect(items).toHaveLength(10)
    expect(items[0]).toHaveTextContent('Hello 15')
    expect(items[9]).toHaveTextContent('Hello 6')
    expect(screen.queryByText('Hello 5')).not.toBeInTheDocument()
  })

  it('does not attach one user\'s hits to another user\'s card', async () => {
    const events = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(listUsers).mockResolvedValue({
      users: [bucket('1', 'User 1'), bucket('2', 'User 2')],
      maxUsers: 10,
    })
    vi.mocked(fetchGreeting).mockImplementation(async (id: string) =>
      greetingHit(`Hello from User ${id}.`, 99, Number(id)),
    )

    render(<App />)
    await screen.findByRole('heading', { name: 'User 1' })
    await events.click(
      within(cardNamed('User 1')).getByRole('button', { name: '1 request' }),
    )

    expect(await screen.findByText('Hello from User 1.')).toBeInTheDocument()
    expect(
      within(cardNamed('User 2')).getByText('No requests yet'),
    ).toBeInTheDocument()
    expect(
      within(cardNamed('User 2')).queryByText('Hello from User 1.'),
    ).not.toBeInTheDocument()
  })

  it('drops only the removed user\'s log so the other card still shows its hits', async () => {
    const events = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(listUsers).mockResolvedValue({
      users: [bucket('1', 'User 1'), bucket('2', 'User 2')],
      maxUsers: 10,
    })
    vi.mocked(fetchGreeting).mockImplementation(async (id: string) =>
      greetingHit(`Hello from User ${id}.`, 99, Number(id)),
    )
    vi.mocked(deleteUser).mockResolvedValue()

    render(<App />)
    await screen.findByRole('heading', { name: 'User 1' })
    await events.click(
      within(cardNamed('User 1')).getByRole('button', { name: '1 request' }),
    )
    await events.click(
      within(cardNamed('User 2')).getByRole('button', { name: '1 request' }),
    )
    await screen.findByText('Hello from User 2.')

    vi.mocked(listUsers).mockResolvedValue({
      users: [bucket('2', 'User 2')],
      maxUsers: 10,
    })
    await events.click(
      within(cardNamed('User 1')).getByRole('button', { name: 'Remove' }),
    )

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'User 1' })).not.toBeInTheDocument()
    })
    expect(screen.getByText('Hello from User 2.')).toBeInTheDocument()
  })

  it('records no hits when any request in a burst rejects, so a partial batch cannot look complete', async () => {
    const events = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(listUsers).mockResolvedValue({
      users: [bucket('1', 'User 1')],
      maxUsers: 10,
    })
    let n = 0
    vi.mocked(fetchGreeting).mockImplementation(async () => {
      n += 1
      if (n === 2) {
        throw new Error('network down')
      }
      return greetingHit(`Hello ${n}`, 99, n)
    })

    render(<App />)
    await screen.findByRole('heading', { name: 'User 1' })
    await events.click(
      within(cardNamed('User 1')).getByRole('button', { name: '3 requests' }),
    )

    expect(await screen.findByText('network down')).toBeInTheDocument()
    expect(
      within(cardNamed('User 1')).getByText('No requests yet'),
    ).toBeInTheDocument()
  })

  it('still logs 429s from a burst because greetings that are rate limited do not reject', async () => {
    const events = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(listUsers).mockResolvedValue({
      users: [bucket('1', 'User 1')],
      maxUsers: 10,
    })
    vi.mocked(fetchGreeting)
      .mockResolvedValueOnce(greetingHit('Hello from User 1.', 99, 1))
      .mockResolvedValueOnce(limitedHit(2))
      .mockResolvedValueOnce(limitedHit(3))

    render(<App />)
    await screen.findByRole('heading', { name: 'User 1' })
    await events.click(
      within(cardNamed('User 1')).getByRole('button', { name: '3 requests' }),
    )

    await waitFor(() => {
      expect(within(cardNamed('User 1')).getAllByText('429')).toHaveLength(2)
    })
    expect(screen.getByText('Hello from User 1.')).toBeInTheDocument()
    expect(screen.queryByText('Request failed')).not.toBeInTheDocument()
  })
})

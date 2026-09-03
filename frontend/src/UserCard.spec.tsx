import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UserCard } from './UserCard'
import type { HitResult, UserBucket } from './types'

const user: UserBucket = {
  id: '1',
  name: 'User 1',
  remaining: 100,
  capacity: 100,
  refillPerSecond: 1.6667,
  windowMs: 60_000,
}

function hit(partial: Partial<HitResult> & Pick<HitResult, 'status'>): HitResult {
  return {
    allowed: partial.status === 200,
    remaining: 99,
    capacity: 100,
    at: 1,
    ...partial,
  }
}

function tank() {
  const card = screen.getByRole('article')
  return card.querySelector('.tank') as HTMLElement
}

function tankFill() {
  const card = screen.getByRole('article')
  return card.querySelector('.tank-fill') as HTMLElement
}

describe('UserCard', () => {
  it('does not show a 429 as the greeting text; it labels it rate limited', () => {
    render(
      <UserCard
        user={user}
        logs={[
          hit({
            status: 429,
            remaining: 0,
            message: 'Too many requests',
          }),
        ]}
        busy={false}
        onHit={() => undefined}
        onRemove={() => undefined}
      />,
    )

    const row = screen.getByText('429').closest('li')
    expect(row).toHaveClass('denied')
    expect(row).toHaveTextContent('rate limited')
    expect(row).not.toHaveTextContent('Too many requests')
  })

  it('keeps a 404 visually distinct from a rate limit so a missing user is not mistaken for an empty bucket', () => {
    render(
      <UserCard
        user={user}
        logs={[
          hit({
            status: 404,
            remaining: 0,
            message: 'User 1 not found',
          }),
        ]}
        busy={false}
        onHit={() => undefined}
        onRemove={() => undefined}
      />,
    )

    const row = screen.getByText('404').closest('li')
    expect(row).toHaveClass('other')
    expect(row).not.toHaveClass('denied')
    expect(row).toHaveTextContent('User 1 not found')
  })

  it('shows fractional tokens instead of rounding a nearly empty bucket to 0', () => {
    render(
      <UserCard
        user={{ ...user, remaining: 0.4 }}
        logs={[]}
        busy={false}
        onHit={() => undefined}
        onRemove={() => undefined}
      />,
    )

    expect(screen.getByText('0.40')).toBeInTheDocument()
    expect(tank()).toHaveClass('low')
  })

  it('clamps tank height when remaining overshoots capacity from refill float error', () => {
    render(
      <UserCard
        user={{ ...user, remaining: 105 }}
        logs={[]}
        busy={false}
        onHit={() => undefined}
        onRemove={() => undefined}
      />,
    )

    expect(tankFill()).toHaveStyle({ height: '100%' })
  })

  it('clamps a negative remaining to an empty tank instead of inverting the fill', () => {
    render(
      <UserCard
        user={{ ...user, remaining: -8 }}
        logs={[]}
        busy={false}
        onHit={() => undefined}
        onRemove={() => undefined}
      />,
    )

    expect(tankFill()).toHaveStyle({ height: '0%' })
    expect(tank()).toHaveClass('low')
  })

  it('disables every burst size while a batch is in flight so a second click cannot stack', async () => {
    const onHit = vi.fn()
    render(
      <UserCard
        user={user}
        logs={[]}
        busy
        onHit={onHit}
        onRemove={() => undefined}
      />,
    )

    const card = screen.getByRole('article')
    for (const name of ['1 request', '3 requests', '5 requests', '10 requests', '50 requests']) {
      expect(within(card).getByRole('button', { name })).toBeDisabled()
    }

    await userEvent.click(within(card).getByRole('button', { name: '50 requests' }))
    expect(onHit).not.toHaveBeenCalled()
  })

  it('asks for 50 parallel requests from the 50 button, not a single greeting', async () => {
    const onHit = vi.fn()
    render(
      <UserCard
        user={user}
        logs={[]}
        busy={false}
        onHit={onHit}
        onRemove={() => undefined}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '50 requests' }))
    expect(onHit).toHaveBeenCalledExactlyOnceWith(50)
  })
})

import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { BucketCacheService } from '../cache/bucket-cache.service.js';
import { UsersRepository } from '../users/users.repository.js';
import { Clock } from './clock.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { TokenBucketService } from './token-bucket.service.js';

class FakeClock extends Clock {
  constructor(public current = 0) {
    super();
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

function setup(startMs = 0) {
  const clock = new FakeClock(startMs);
  const users = new UsersRepository();
  const cache = new BucketCacheService();
  const tokenBucket = new TokenBucketService(cache, users, clock);
  const user = users.create();
  return { clock, users, cache, tokenBucket, user };
}

describe('TokenBucketService', () => {
  it('seeds a full bucket on cache miss after a DB lookup', async () => {
    const { tokenBucket, cache, user } = setup(1_000);
    expect(await cache.get(user.id)).toBeUndefined();

    const snapshot = await tokenBucket.peek(user.id);

    expect(snapshot.remaining).toBe(100);
    expect((await cache.get(user.id))?.tokens).toBe(100);
    expect((await cache.get(user.id))?.lastRefillAt).toBe(1_000);
  });

  it('consume spends one token and peek does not', async () => {
    const { tokenBucket, user } = setup();

    expect((await tokenBucket.consume(user.id)).remaining).toBe(99);
    expect((await tokenBucket.peek(user.id)).remaining).toBe(99);
    expect((await tokenBucket.peek(user.id)).remaining).toBe(99);
  });

  it('caps refill at 100 after time passes on a nearly full bucket', async () => {
    const { tokenBucket, clock, user } = setup(0);
    await tokenBucket.consume(user.id);
    expect((await tokenBucket.peek(user.id)).remaining).toBe(99);

    clock.advance(6_000);

    expect((await tokenBucket.peek(user.id)).remaining).toBe(100);
  });

  it('adds 10 tokens after 6s when the bucket is not full', async () => {
    const { tokenBucket, clock, cache, user } = setup(0);
    await cache.set(user.id, { tokens: 0, lastRefillAt: 0 });

    clock.advance(6_000);

    expect((await tokenBucket.peek(user.id)).remaining).toBe(10);
  });

  it('denies consume when fewer than one token remains', async () => {
    const { tokenBucket, cache, user } = setup(0);
    await cache.set(user.id, { tokens: 0.4, lastRefillAt: 0 });

    const denied = await tokenBucket.consume(user.id);

    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0.4);
    expect(denied.retryAfterMs).toBe(360);
  });

  it('throws 404 when the user is not in the DB', async () => {
    const { tokenBucket } = setup();
    await expect(tokenBucket.peek('missing')).rejects.toThrow(NotFoundException);
  });

  describe('lost-update race of peek and consume', () => {
    it('raw cache copies still lose a decrement without a lock', async () => {
      const { tokenBucket, cache, user } = setup(0);
      await tokenBucket.peek(user.id);

      const copyA = (await cache.get(user.id))!;
      const copyB = (await cache.get(user.id))!;
      copyA.tokens -= 1;
      copyB.tokens -= 1;
      await cache.set(user.id, copyA);
      await cache.set(user.id, copyB);

      expect((await tokenBucket.peek(user.id)).remaining).toBe(99);
    });

    it('bills both tokens when two consumes overlap', async () => {
      const { tokenBucket, user } = setup(0);
      await tokenBucket.peek(user.id);

      const [first, second] = await Promise.all([
        tokenBucket.consume(user.id),
        tokenBucket.consume(user.id),
      ]);

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect((await tokenBucket.peek(user.id)).remaining).toBe(98);
    });

    it('does not let peek undo an overlapping consume', async () => {
      const { tokenBucket, user } = setup(0);
      await tokenBucket.peek(user.id);

      await Promise.all([
        tokenBucket.consume(user.id),
        tokenBucket.peek(user.id),
      ]);

      expect((await tokenBucket.peek(user.id)).remaining).toBe(99);
    });
  });
});

describe('RateLimitGuard', () => {
  it('returns 429 only when consume denies; other errors keep their status', async () => {
    const consume = vi.fn();
    const guard = new RateLimitGuard({ consume } as never);
    const response = { setHeader: vi.fn() };

    const contextFor = (id: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ params: { id } }),
          getResponse: () => response,
        }),
      }) as never;

    consume.mockResolvedValue({
      allowed: true,
      remaining: 99,
      capacity: 100,
    });
    expect(await guard.canActivate(contextFor('1'))).toBe(true);

    consume.mockResolvedValue({
      allowed: false,
      remaining: 0,
      capacity: 100,
      retryAfterMs: 600,
    });
    try {
      await guard.canActivate(contextFor('1'));
      throw new Error('expected 429');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    consume.mockRejectedValue(new NotFoundException('User missing not found'));
    await expect(guard.canActivate(contextFor('missing'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

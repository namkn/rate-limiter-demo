import { ConflictException, NotFoundException } from '@nestjs/common';
import { BucketCacheService } from '../cache/bucket-cache.service.js';
import { Clock } from '../token-bucket/clock.js';
import { TokenBucketService } from '../token-bucket/token-bucket.service.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

class FakeClock extends Clock {
  constructor(public current = 0) {
    super();
  }

  now(): number {
    return this.current;
  }
}

function setup(startMs = 0) {
  const clock = new FakeClock(startMs);
  const users = new UsersRepository();
  const cache = new BucketCacheService();
  const tokenBucket = new TokenBucketService(cache, users, clock);
  const service = new UsersService(users, tokenBucket, clock);
  return { clock, users, service };
}

describe('UsersService', () => {
  it('returns a greeting loaded from the DB', async () => {
    const { service, clock } = setup(1_700_000_000_000);
    const user = await service.create();

    expect(service.greeting(user.id)).toEqual({
      userId: user.id,
      servedAt: '2023-11-14T22:13:20.000Z',
      message: 'Hello from User 1.',
    });
    expect(clock.current).toBe(1_700_000_000_000);
  });

  it('throws 404 for greeting when the user is missing', () => {
    const { service } = setup();
    expect(() => service.greeting('99')).toThrow(NotFoundException);
  });

  it('rejects an 11th user with 409', async () => {
    const { service } = setup();
    for (let i = 0; i < 10; i++) {
      await service.create();
    }
    await expect(service.create()).rejects.toThrow(ConflictException);
  });
});

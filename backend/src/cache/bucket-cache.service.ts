import { Injectable } from '@nestjs/common';

export interface CachedBucket {
  tokens: number;
  lastRefillAt: number;
}

/** In-memory stand-in for Redis. Rate-limit buckets live here, not in the DB. */
@Injectable()
export class BucketCacheService {
  private readonly store = new Map<string, CachedBucket>();

  async get(userId: string): Promise<CachedBucket | undefined> {
    await Promise.resolve();
    const bucket = this.store.get(userId);
    return bucket ? { ...bucket } : undefined;
  }

  async set(userId: string, bucket: CachedBucket): Promise<void> {
    await Promise.resolve();
    this.store.set(userId, { ...bucket });
  }

  async delete(userId: string): Promise<void> {
    await Promise.resolve();
    this.store.delete(userId);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { BucketCacheService } from '../cache/bucket-cache.service.js';
import { UsersRepository } from '../users/users.repository.js';
import { Clock } from './clock.js';
import {
  BUCKET_CAPACITY,
  REFILL_PER_MS,
  REFILL_PER_SECOND,
  WINDOW_MS,
} from './token-bucket.constants.js';

export interface BucketSnapshot {
  remaining: number;
  capacity: number;
  refillPerSecond: number;
  windowMs: number;
}

export interface ConsumeResult extends BucketSnapshot {
  allowed: boolean;
  retryAfterMs?: number;
}

/**
 * peek() and consume() are read-modify-write on the cache (GET copy → change → SET).
 * Without a lock, two callers can hold the same snapshot and last write wins:
 * two consumes both read 100 and both write 99, or a stale peek undoes a consume.
 *
 * Cache get/set await (like Redis). withLock(userId) runs one RMW per user at a
 * time so overlapping copies cannot clobber each other. Different users still run
 * in parallel.
 */
@Injectable()
export class TokenBucketService {
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(
    private readonly cache: BucketCacheService,
    private readonly users: UsersRepository,
    private readonly clock: Clock,
  ) {}

  peek(userId: string): Promise<BucketSnapshot> {
    return this.withLock(userId, () => this.peekUnlocked(userId));
  }

  consume(userId: string): Promise<ConsumeResult> {
    return this.withLock(userId, () => this.consumeUnlocked(userId));
  }

  invalidate(userId: string): Promise<void> {
    return this.withLock(userId, () => this.cache.delete(userId));
  }

  private async peekUnlocked(userId: string): Promise<BucketSnapshot> {
    const bucket = await this.loadBucket(userId);
    this.refill(bucket);
    await this.cache.set(userId, bucket);
    return this.snapshot(bucket);
  }

  private async consumeUnlocked(userId: string): Promise<ConsumeResult> {
    const bucket = await this.loadBucket(userId);
    this.refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      await this.cache.set(userId, bucket);
      return { ...this.snapshot(bucket), allowed: true };
    }

    const tokensNeeded = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(tokensNeeded / REFILL_PER_MS);
    await this.cache.set(userId, bucket);

    return {
      ...this.snapshot(bucket),
      allowed: false,
      retryAfterMs,
    };
  }

  private withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(userId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.tails.set(
      userId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async loadBucket(userId: string) {
    const cached = await this.cache.get(userId);
    if (cached) {
      return cached;
    }

    const user = this.users.findById(userId);
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    return {
      tokens: BUCKET_CAPACITY,
      lastRefillAt: this.clock.now(),
    };
  }

  private refill(bucket: { tokens: number; lastRefillAt: number }): void {
    const now = this.clock.now();
    const elapsedMs = now - bucket.lastRefillAt;
    if (elapsedMs > 0) {
      bucket.tokens = Math.min(
        BUCKET_CAPACITY,
        bucket.tokens + elapsedMs * REFILL_PER_MS,
      );
      bucket.lastRefillAt = now;
    }
  }

  private snapshot(bucket: { tokens: number }): BucketSnapshot {
    return {
      remaining: Number(bucket.tokens.toFixed(4)),
      capacity: BUCKET_CAPACITY,
      refillPerSecond: Number(REFILL_PER_SECOND.toFixed(4)),
      windowMs: WINDOW_MS,
    };
  }
}

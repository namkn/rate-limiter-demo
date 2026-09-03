import { Module } from '@nestjs/common';
import { BucketCacheService } from '../cache/bucket-cache.service.js';
import { Clock } from '../token-bucket/clock.js';
import { RateLimitGuard } from '../token-bucket/rate-limit.guard.js';
import { TokenBucketService } from '../token-bucket/token-bucket.service.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersRepository,
    TokenBucketService,
    BucketCacheService,
    RateLimitGuard,
    Clock,
  ],
})
export class UsersModule {}

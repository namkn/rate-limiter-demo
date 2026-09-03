import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { TokenBucketService } from './token-bucket.service.js';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly tokenBucket: TokenBucketService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const rawId = request.params.id;
    const userId = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!userId) {
      throw new HttpException('Missing user id', HttpStatus.BAD_REQUEST);
    }

    const result = await this.tokenBucket.consume(userId);

    response.setHeader('X-RateLimit-Limit', String(result.capacity));
    response.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((result.retryAfterMs ?? 0) / 1000),
      );
      response.setHeader('Retry-After', String(retryAfterSec));
      throw new HttpException(
        {
          message: 'Too many requests',
          allowed: false,
          remaining: result.remaining,
          capacity: result.capacity,
          retryAfterMs: result.retryAfterMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

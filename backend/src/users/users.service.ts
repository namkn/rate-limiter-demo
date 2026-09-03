import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MAX_USERS } from '../token-bucket/token-bucket.constants.js';
import { Clock } from '../token-bucket/clock.js';
import { TokenBucketService } from '../token-bucket/token-bucket.service.js';
import { UsersRepository } from './users.repository.js';

export interface UserView {
  id: string;
  name: string;
  remaining: number;
  capacity: number;
  refillPerSecond: number;
  windowMs: number;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly tokenBucket: TokenBucketService,
    private readonly clock: Clock,
  ) {}

  async create(): Promise<UserView> {
    if (this.users.size >= MAX_USERS) {
      throw new ConflictException(`Maximum of ${MAX_USERS} users reached`);
    }

    const user = this.users.create();
    return { ...user, ...(await this.tokenBucket.peek(user.id)) };
  }

  async list(): Promise<{ users: UserView[]; maxUsers: number }> {
    const users = await Promise.all(
      this.users.findAll().map(async (user) => ({
        ...user,
        ...(await this.tokenBucket.peek(user.id)),
      })),
    );

    return { users, maxUsers: MAX_USERS };
  }

  async remove(id: string): Promise<void> {
    if (!this.users.findById(id)) {
      throw new NotFoundException(`User ${id} not found`);
    }
    this.users.delete(id);
    await this.tokenBucket.invalidate(id);
  }

  greeting(id: string): { message: string; userId: string; servedAt: string } {
    const user = this.users.findById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return {
      userId: user.id,
      servedAt: new Date(this.clock.now()).toISOString(),
      message: `Hello from ${user.name}.`,
    };
  }
}

import { Injectable } from '@nestjs/common';

export interface UserRecord {
  id: string;
  name: string;
}

/** In-memory stand-in for a user database. */
@Injectable()
export class UsersRepository {
  private nextId = 1;
  private readonly users = new Map<string, UserRecord>();

  get size(): number {
    return this.users.size;
  }

  create(): UserRecord {
    const id = String(this.nextId);
    const user: UserRecord = { id, name: `User ${this.nextId}` };
    this.nextId += 1;
    this.users.set(id, user);
    return user;
  }

  findById(id: string): UserRecord | undefined {
    return this.users.get(id);
  }

  findAll(): UserRecord[] {
    return [...this.users.values()];
  }

  delete(id: string): boolean {
    return this.users.delete(id);
  }
}

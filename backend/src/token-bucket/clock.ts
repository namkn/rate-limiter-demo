import { Injectable } from '@nestjs/common';

@Injectable()
export class Clock {
  now(): number {
    return Date.now();
  }
}

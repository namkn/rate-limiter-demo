import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('Users API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a greeting only after the rate limiter allows the request', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .expect(201);

    expect(created.body.name).toBe('User 1');
    expect(created.body.remaining).toBe(100);

    const greeting = await request(app.getHttpServer())
      .get(`/api/users/${created.body.id}/greeting`)
      .expect(200);

    expect(greeting.body.message).toContain('Hello from User 1');
    expect(greeting.body.allowed).toBeUndefined();
    expect(Number(greeting.headers['x-ratelimit-remaining'])).toBeLessThan(100);
  });

  it('rejects greetings with 429 when the bucket is empty', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .expect(201);

    let limited: { status: number; body: { allowed?: boolean; message?: string } } | undefined;
    for (let i = 0; i < 200; i++) {
      const res = await request(app.getHttpServer()).get(
        `/api/users/${created.body.id}/greeting`,
      );
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    expect(limited).toBeDefined();
    expect(limited?.body.allowed).toBe(false);
    expect(limited?.body.message).toBe('Too many requests');
  });

  it('returns 404 for greeting when the user does not exist', async () => {
    await request(app.getHttpServer())
      .get('/api/users/missing/greeting')
      .expect(404);
  });

  it('lists users', async () => {
    await request(app.getHttpServer()).post('/api/users').expect(201);

    const listed = await request(app.getHttpServer())
      .get('/api/users')
      .expect(200);

    expect(listed.body.maxUsers).toBe(10);
    expect(listed.body.users).toHaveLength(1);
  });
});

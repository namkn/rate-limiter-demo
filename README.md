# Token Bucket Rate Limiter Demo

A Nest.js API and React dashboard that show how a **token bucket** rate limiter gates a real endpoint.

Each user gets a bucket of **100 tokens**. Tokens refill continuously at 100 per 60 seconds (~1.67/sec). Bucket state lives in an **in-memory cache** (stand-in for Redis). User records live in an **in-memory DB**. The limiter checks the cache first; it only hits the DB on a cache miss (unknown user / new bucket).

`GET /api/users/:id/greeting` is the product endpoint. A Nest **guard** spends one token before the handler runs. If the bucket is empty you get **429** and the handler never loads the user. If allowed, the handler reads the user from the DB and returns a greeting.

## Run locally

You need two terminals (Node 20+).

### Backend (port 3000)

```bash
cd backend
npm install
npm run start:dev
```

### Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to Nest.

## How to use it

1. Click **Add user** (up to 10 users, all shown on one page).
2. Fire **1 / 3 / 5 / 10 / 50** real parallel **GET**s to that user's greeting endpoint.
3. Allowed calls show `200` plus the greeting. An empty bucket shows `429`. Other failures (missing user, etc.) keep their real status, such as `404`.
4. The per-user log keeps the last **10** results. Watch the tank drop, then refill every second even while idle.

Restarting the backend clears the DB and the cache.

## Lost-update race (`peek` / `consume`)

Both functions do **read-modify-write** on the cache: GET a copy, refill (and maybe decrement), SET the copy back. `BucketCacheService.get()` clones the record and awaits (like Redis), so two callers can hold the same snapshot. Without coordination, last write wins:

- Two consumes that both read 100 both write 99: two requests allowed, only one token billed.
- A peek that read 100 can SET after a consume wrote 99: the decrement is undone.

`TokenBucketService` serializes peek/consume/invalidate **per user** with a promise chain lock. Overlapping copies for the same user cannot clobber each other; different users still run in parallel. Production Redis limiters usually do the same job with a Lua script or `WATCH`.

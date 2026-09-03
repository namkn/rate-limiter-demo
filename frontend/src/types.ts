export interface UserBucket {
  id: string
  name: string
  remaining: number
  capacity: number
  refillPerSecond: number
  windowMs: number
}

export interface UsersResponse {
  users: UserBucket[]
  maxUsers: number
}

export interface HitResult {
  allowed: boolean
  remaining: number
  capacity: number
  retryAfterMs?: number
  status: number
  message?: string
  at: number
}

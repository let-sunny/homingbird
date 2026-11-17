export interface RateLimiter {
  readonly allow: (key: string, limit: Limit) => boolean
}

export interface Limit {
  readonly max: number
  readonly windowMs: number
}

export const makeRateLimiter = (now: () => number): RateLimiter => {
  const windows = new Map<string, { startedAt: number; count: number }>()
  return {
    allow: (key, limit) => {
      const current = now()
      if (windows.size > MAX_TRACKED_KEYS) forgetExpired(windows, current)
      const window = windows.get(key)
      if (window === undefined || current - window.startedAt >= limit.windowMs) {
        windows.set(key, { startedAt: current, count: 1 })
        return true
      }
      window.count += 1
      return window.count <= limit.max
    },
  }
}

export const LIMITS = {
  signIn: { max: 30, windowMs: 60_000 },
  token: { max: 120, windowMs: 60_000 },
  registration: { max: 20, windowMs: 3_600_000 },
  deviceStart: { max: 30, windowMs: 3_600_000 },
  drafting: { max: 120, windowMs: 60_000 },
} as const satisfies Readonly<Record<string, Limit>>

const MAX_TRACKED_KEYS = 50_000
const LONGEST_WINDOW_MS = 3_600_000

const forgetExpired = (windows: Map<string, { startedAt: number }>, current: number): void => {
  for (const [key, window] of windows) if (current - window.startedAt >= LONGEST_WINDOW_MS) windows.delete(key)
}

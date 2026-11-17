export interface Clock {
  readonly now: () => number
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
}
export interface HasClock {
  readonly clock: Clock
}
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve()
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      signal.addEventListener('abort', done, { once: true })
    }),
}
export interface TestClock extends Clock {
  readonly advance: (ms: number) => Promise<void>
  readonly pending: () => number
  readonly flush: () => Promise<void>
}
export const makeTestClock = (start = 0): TestClock => {
  let now = start
  let order = 0
  let sleepers: Sleeper[] = []

  const earliest = (limit: number): Sleeper | undefined =>
    sleepers.filter((s) => s.wakeAt <= limit).sort((a, b) => a.wakeAt - b.wakeAt || a.order - b.order)[0]

  return {
    now: () => now,
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve()
        const sleeper: Sleeper = {
          wakeAt: now + Math.max(0, ms),
          order: order++,
          wake: () => {
            sleepers = sleepers.filter((s) => s !== sleeper)
            signal.removeEventListener('abort', sleeper.wake)
            resolve()
          },
        }
        sleepers.push(sleeper)
        signal.addEventListener('abort', sleeper.wake, { once: true })
      }),
    advance: async (ms) => {
      const target = now + ms
      await settle()
      for (let next = earliest(target); next; next = earliest(target)) {
        now = Math.max(now, next.wakeAt)
        next.wake()
        await settle()
      }
      now = target
    },
    pending: () => sleepers.length,
    flush: settle,
  }
}

interface Sleeper {
  readonly wakeAt: number
  readonly order: number
  readonly wake: () => void
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

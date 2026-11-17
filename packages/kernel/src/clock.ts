/**
 * Time as a service. Production code asks the environment for a Clock; tests hand it a virtual one
 * and move time by hand, so no test ever waits on a real timer.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  readonly now: () => number
  /** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
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
  /** Moves time forward, waking sleepers in order and letting their continuations run. */
  readonly advance: (ms: number) => Promise<void>
  /** Number of sleepers still waiting. */
  readonly pending: () => number
  /** Lets already-scheduled continuations run without moving time. */
  readonly flush: () => Promise<void>
}

interface Sleeper {
  readonly wakeAt: number
  readonly order: number
  readonly wake: () => void
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export const makeTestClock = (start = 0): TestClock => {
  let now = start
  let order = 0
  let sleepers: Sleeper[] = []

  const earliest = (limit: number): Sleeper | undefined =>
    sleepers
      .filter((s) => s.wakeAt <= limit)
      .sort((a, b) => a.wakeAt - b.wakeAt || a.order - b.order)[0]

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

import { type Clock, type HasClock, Task as T, type TestClock, err, makeTestClock } from '../src/index.ts'

export const failed = <E>(error: E) => err(T.failCause(error))
export const died = (defect: unknown) => err(T.dieCause(defect))
export const interrupted = err(T.interruptCause)

export const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export const isSettled = async (promise: Promise<unknown>): Promise<boolean> => {
  let settled = false
  void promise.then(() => {
    settled = true
  })
  await flush()
  return settled
}

export interface Probe<A> {
  started: number
  finished: number
  cleaned: number
  readonly task: T.Task<A, never, HasClock>
}

export const probe = <A = void>(ms: number, value?: A, cleanupMs = 0): Probe<A> => {
  const self: Probe<A> = {
    started: 0,
    finished: 0,
    cleaned: 0,
    task: T.gen(function* () {
      self.started++
      try {
        yield* T.sleep(ms)
        self.finished++
        return value as A
      } finally {
        if (cleanupMs > 0) yield* T.sleep(cleanupMs)
        self.cleaned++
      }
    }),
  }
  return self
}

export const setup = (start = 0): { clock: TestClock; env: { clock: Clock } } => {
  const clock = makeTestClock(start)
  return { clock, env: { clock } }
}

export const trackListeners = (signal: AbortSignal): (() => number) => {
  let count = 0
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)
  const live = new Set<unknown>()
  signal.addEventListener = ((type: string, listener: unknown, options?: unknown) => {
    if (type === 'abort' && !live.has(listener)) {
      live.add(listener)
      count++
    }
    return add(type as 'abort', listener as () => void, options as never)
  }) as typeof signal.addEventListener
  signal.removeEventListener = ((type: string, listener: unknown) => {
    if (type === 'abort' && live.delete(listener)) count--
    return remove(type as 'abort', listener as () => void)
  }) as typeof signal.removeEventListener
  return () => count
}

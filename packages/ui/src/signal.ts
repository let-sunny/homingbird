export interface Signal<A> {
  readonly get: () => A
  readonly set: (value: A) => void
  readonly update: (change: (current: A) => A) => void
  readonly subscribe: (listener: (value: A) => void) => Unsubscribe
}

export type ReadableSignal<A> = Pick<Signal<A>, 'get' | 'subscribe'>

export type Unsubscribe = () => void

export const signal = <A>(initial: A): Signal<A> => {
  let current = initial
  const listeners = new Set<(value: A) => void>()
  const set = (value: A): void => {
    if (Object.is(value, current)) return
    current = value
    for (const listener of [...listeners]) notify(listener, current, () => listeners.has(listener))
  }
  return {
    get: () => current,
    set,
    update: (change) => set(change(current)),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * A value computed from its sources. Its subscribers hear of it only when the value changes by
 * `equals`, so a view that depends on one slice of a broad state does not redraw for the rest.
 */
export const derived = <const Sources extends ReadonlyArray<ReadableSignal<any>>, A>(
  sources: Sources,
  compute: (...values: ValuesOf<Sources>) => A,
  equals: (previous: A, next: A) => boolean = Object.is,
): ReadableSignal<A> => {
  const read = (): A => compute(...(sources.map((source) => source.get()) as ValuesOf<Sources>))
  return {
    get: read,
    subscribe: (listener) => {
      let last = read()
      const unsubscribes = sources.map((source) =>
        source.subscribe(() => {
          const next = read()
          if (equals(last, next)) return
          last = next
          listener(next)
        }),
      )
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    },
  }
}

/**
 * Makes several changes as one: each listener hears once, after the last change, however many of
 * the signals it follows changed. A listener that one change notifies twice runs once.
 */
export const batch = <A>(change: () => A): A => {
  batchDepth++
  try {
    return change()
  } finally {
    batchDepth--
    if (batchDepth === 0) flushBatch()
  }
}

export const onAnyChange = (
  sources: ReadonlyArray<ReadableSignal<unknown>>,
  react: () => void,
): Unsubscribe => {
  const unsubscribes = sources.map((source) => source.subscribe(react))
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
}

type ValuesOf<Sources> = {
  -readonly [K in keyof Sources]: Sources[K] extends ReadableSignal<infer A> ? A : never
}

interface Pending {
  readonly value: unknown
  readonly isSubscribed: () => boolean
}

let batchDepth = 0
const pending = new Map<(value: never) => void, Pending>()

const notify = <A>(listener: (value: A) => void, value: A, isSubscribed: () => boolean): void => {
  if (batchDepth === 0) listener(value)
  else pending.set(listener as (value: never) => void, { value, isSubscribed })
}

const flushBatch = (): void => {
  batchDepth++
  try {
    for (const [listener, waiting] of pending) {
      pending.delete(listener)
      if (waiting.isSubscribed()) (listener as (value: unknown) => void)(waiting.value)
    }
  } finally {
    batchDepth--
  }
}

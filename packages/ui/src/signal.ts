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
    for (const listener of [...listeners]) listener(current)
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

export const derived = <const Sources extends ReadonlyArray<ReadableSignal<any>>, A>(
  sources: Sources,
  compute: (...values: ValuesOf<Sources>) => A,
): ReadableSignal<A> => {
  const read = (): A => compute(...(sources.map((source) => source.get()) as ValuesOf<Sources>))
  return {
    get: read,
    subscribe: (listener) => {
      let last = read()
      const unsubscribes = sources.map((source) =>
        source.subscribe(() => {
          const next = read()
          if (Object.is(next, last)) return
          last = next
          listener(next)
        }),
      )
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    },
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

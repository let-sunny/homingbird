/**
 * Lazy, pull-based combinators over synchronous iterables. Every combinator is a generator:
 * nothing runs until the consumer pulls, and stopping early stops the source.
 */

export const map =
  <A, B>(f: (a: A, index: number) => B) =>
  (source: Iterable<A>): Iterable<B> => ({
    *[Symbol.iterator]() {
      let i = 0
      for (const a of source) yield f(a, i++)
    },
  })

export const filter: {
  <A, B extends A>(p: (a: A) => a is B): (source: Iterable<A>) => Iterable<B>
  <A>(p: (a: A) => boolean): (source: Iterable<A>) => Iterable<A>
} =
  <A>(p: (a: A) => boolean) =>
  (source: Iterable<A>): Iterable<A> => ({
    *[Symbol.iterator]() {
      for (const a of source) if (p(a)) yield a
    },
  })

export const flatMap =
  <A, B>(f: (a: A) => Iterable<B>) =>
  (source: Iterable<A>): Iterable<B> => ({
    *[Symbol.iterator]() {
      for (const a of source) yield* f(a)
    },
  })

export const take =
  (n: number) =>
  <A>(source: Iterable<A>): Iterable<A> => ({
    *[Symbol.iterator]() {
      if (n <= 0) return
      let i = 0
      for (const a of source) {
        yield a
        if (++i >= n) return
      }
    },
  })

export const drop =
  (n: number) =>
  <A>(source: Iterable<A>): Iterable<A> => ({
    *[Symbol.iterator]() {
      let i = 0
      for (const a of source) if (i++ >= n) yield a
    },
  })

export const takeWhile =
  <A>(p: (a: A) => boolean) =>
  (source: Iterable<A>): Iterable<A> => ({
    *[Symbol.iterator]() {
      for (const a of source) {
        if (!p(a)) return
        yield a
      }
    },
  })

/** Running fold: yields every intermediate state, not the seed. */
export const scan =
  <A, S>(seed: S, f: (state: S, a: A) => S) =>
  (source: Iterable<A>): Iterable<S> => ({
    *[Symbol.iterator]() {
      let state = seed
      for (const a of source) yield (state = f(state, a))
    },
  })

export const chunk =
  (size: number) =>
  <A>(source: Iterable<A>): Iterable<A[]> => ({
    *[Symbol.iterator]() {
      if (size < 1) throw new RangeError('chunk size must be at least 1')
      let buffer: A[] = []
      for (const a of source) {
        buffer.push(a)
        if (buffer.length === size) {
          yield buffer
          buffer = []
        }
      }
      if (buffer.length > 0) yield buffer
    },
  })

export const zip =
  <B>(other: Iterable<B>) =>
  <A>(source: Iterable<A>): Iterable<[A, B]> => ({
    *[Symbol.iterator]() {
      const it = other[Symbol.iterator]()
      try {
        for (const a of source) {
          const b = it.next()
          if (b.done) return
          yield [a, b.value]
        }
      } finally {
        it.return?.()
      }
    },
  })

export const enumerate = <A>(source: Iterable<A>): Iterable<[number, A]> => map((a: A, i) => [i, a] as [number, A])(source)

export const concat =
  <B>(...others: ReadonlyArray<Iterable<B>>) =>
  <A>(source: Iterable<A>): Iterable<A | B> => ({
    *[Symbol.iterator]() {
      yield* source
      for (const other of others) yield* other
    },
  })

export const dedupeBy =
  <A, K>(key: (a: A) => K) =>
  (source: Iterable<A>): Iterable<A> => ({
    *[Symbol.iterator]() {
      const seen = new Set<K>()
      for (const a of source) {
        const k = key(a)
        if (seen.has(k)) continue
        seen.add(k)
        yield a
      }
    },
  })

/** `start, start + step, ...` up to but excluding `end`. Infinite when `end` is omitted. */
export function* range(start = 0, end = Number.POSITIVE_INFINITY, step = 1): Generator<number, void> {
  if (step === 0) throw new RangeError('range step must not be 0')
  for (let i = start; step > 0 ? i < end : i > end; i += step) yield i
}

/** `seed, f(seed), f(f(seed)), ...` forever. */
export function* iterate<A>(seed: A, f: (a: A) => A): Generator<A, never> {
  for (let a = seed; ; a = f(a)) yield a
}

export function* repeat<A>(a: A): Generator<A, never> {
  for (;;) yield a
}

export const reduce =
  <A, S>(seed: S, f: (state: S, a: A) => S) =>
  (source: Iterable<A>): S => {
    let state = seed
    for (const a of source) state = f(state, a)
    return state
  }

export const toArray = <A>(source: Iterable<A>): A[] => Array.from(source)

export const first = <A>(source: Iterable<A>): A | undefined => {
  for (const a of source) return a
  return undefined
}

export const find =
  <A>(p: (a: A) => boolean) =>
  (source: Iterable<A>): A | undefined =>
    first(filter(p)(source))

export const some =
  <A>(p: (a: A) => boolean) =>
  (source: Iterable<A>): boolean => {
    for (const a of source) if (p(a)) return true
    return false
  }

export const every =
  <A>(p: (a: A) => boolean) =>
  (source: Iterable<A>): boolean => {
    for (const a of source) if (!p(a)) return false
    return true
  }

export const count = <A>(source: Iterable<A>): number => reduce<A, number>(0, (n) => n + 1)(source)

export const groupBy =
  <A, K>(key: (a: A) => K) =>
  (source: Iterable<A>): Map<K, A[]> => {
    const groups = new Map<K, A[]>()
    for (const a of source) {
      const k = key(a)
      const group = groups.get(k)
      group ? group.push(a) : groups.set(k, [a])
    }
    return groups
  }

/**
 * Combinators over AsyncIterable. Each one is an async generator: demand-driven, and closing the
 * consumer closes the source.
 *
 * Sources that can wait indefinitely (subscriptions, timers) take an AbortSignal and end when it
 * aborts; that is how a pipeline is torn down from the outside.
 */
import type { Clock } from './clock.ts'
import { err, isOk, ok } from './result.ts'
import * as T from './task.ts'

export type Stream<A> = AsyncIterable<A>

export const fromIterable = <A>(source: Iterable<A>): Stream<A> => ({
  async *[Symbol.asyncIterator]() {
    yield* source
  },
})

export const of = <A>(...items: A[]): Stream<A> => fromIterable(items)

export const empty: Stream<never> = fromIterable([])

/** Emits `0, 1, 2, ...` every `ms` until the signal aborts. */
export const interval = (clock: Clock, ms: number, signal: AbortSignal): Stream<number> => ({
  async *[Symbol.asyncIterator]() {
    for (let i = 0; ; i++) {
      await clock.sleep(ms, signal)
      if (signal.aborted) return
      yield i
    }
  },
})

export const map =
  <A, B>(f: (a: A) => B | Promise<B>) =>
  (source: Stream<A>): Stream<B> => ({
    async *[Symbol.asyncIterator]() {
      for await (const a of source) yield await f(a)
    },
  })

export const filter: {
  <A, B extends A>(p: (a: A) => a is B): (source: Stream<A>) => Stream<B>
  <A>(p: (a: A) => boolean): (source: Stream<A>) => Stream<A>
} =
  <A>(p: (a: A) => boolean) =>
  (source: Stream<A>): Stream<A> => ({
    async *[Symbol.asyncIterator]() {
      for await (const a of source) if (p(a)) yield a
    },
  })

export const flatMap =
  <A, B>(f: (a: A) => Stream<B> | Iterable<B>) =>
  (source: Stream<A>): Stream<B> => ({
    async *[Symbol.asyncIterator]() {
      for await (const a of source) yield* f(a)
    },
  })

export const take =
  (n: number) =>
  <A>(source: Stream<A>): Stream<A> => ({
    async *[Symbol.asyncIterator]() {
      if (n <= 0) return
      let i = 0
      for await (const a of source) {
        yield a
        if (++i >= n) return
      }
    },
  })

export const takeWhile =
  <A>(p: (a: A) => boolean) =>
  (source: Stream<A>): Stream<A> => ({
    async *[Symbol.asyncIterator]() {
      for await (const a of source) {
        if (!p(a)) return
        yield a
      }
    },
  })

export const scan =
  <A, S>(seed: S, f: (state: S, a: A) => S) =>
  (source: Stream<A>): Stream<S> => ({
    async *[Symbol.asyncIterator]() {
      let state = seed
      for await (const a of source) yield (state = f(state, a))
    },
  })

export const concat =
  <B>(...others: ReadonlyArray<Stream<B>>) =>
  <A>(source: Stream<A>): Stream<A | B> => ({
    async *[Symbol.asyncIterator]() {
      yield* source
      for (const other of others) yield* other
    },
  })

/**
 * Interleaves streams as their items arrive. Ends when every source has ended; closing the merged
 * stream closes every source.
 */
export const merge = <A>(...sources: ReadonlyArray<Stream<A>>): Stream<A> => ({
  async *[Symbol.asyncIterator]() {
    const iterators = sources.map((s) => s[Symbol.asyncIterator]())
    const pull = (index: number) => iterators[index]!.next().then((step) => ({ index, step }))
    const pending = new Map(iterators.map((_, index) => [index, pull(index)]))
    try {
      while (pending.size > 0) {
        const { index, step } = await Promise.race(pending.values())
        if (step.done) pending.delete(index)
        else {
          pending.set(index, pull(index))
          yield step.value
        }
      }
    } finally {
      for (const it of iterators) void it.return?.()?.catch(() => {})
    }
  },
})

/**
 * Ends the stream as soon as the signal aborts, even while a pull is outstanding. The source is
 * asked to close but is not awaited.
 */
export const untilAborted =
  (signal: AbortSignal) =>
  <A>(source: Stream<A>): Stream<A> => ({
    [Symbol.asyncIterator](): AsyncIterator<A> {
      const it = source[Symbol.asyncIterator]()
      const done: IteratorResult<A> = { done: true, value: undefined }
      let finished = false
      const finish = (): IteratorResult<A> => {
        if (!finished) {
          finished = true
          void it.return?.()?.catch(() => {})
        }
        return done
      }
      return {
        next: () =>
          new Promise<IteratorResult<A>>((resolve, reject) => {
            if (finished || signal.aborted) return resolve(finish())
            const onAbort = () => resolve(finish())
            signal.addEventListener('abort', onAbort, { once: true })
            it.next().then(
              (step) => {
                signal.removeEventListener('abort', onAbort)
                if (step.done) finished = true
                resolve(signal.aborted ? finish() : step)
              },
              (error) => {
                signal.removeEventListener('abort', onAbort)
                finished = true
                reject(error)
              },
            )
          }),
        return: async () => finish(),
      }
    },
  })

/** Collects a finite stream. */
export const toArray = <A>(source: Stream<A>): T.Task<A[]> =>
  T.promise(async (signal) => {
    const out: A[] = []
    for await (const a of untilAborted(signal)(source)) out.push(a)
    return out
  })

/** Runs a task for every item, one at a time. Interrupting the task closes the stream. */
export const forEach =
  <A, E, R>(f: (a: A) => T.Task<unknown, E, R>) =>
  (source: Stream<A>): T.Task<void, E, R> =>
    T.make<void, E, R>(async (env, signal) => {
      for await (const a of untilAborted(signal)(source)) {
        const exit = await f(a).run(env, signal)
        if (!isOk(exit)) return exit as T.Exit<never, E>
      }
      return signal.aborted ? err(T.interruptCause) : ok(undefined)
    })

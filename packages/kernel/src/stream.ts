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

export const interval = (clock: Clock, ms: number, signal: AbortSignal): Stream<number> => ({
  async *[Symbol.asyncIterator]() {
    let tick = 0
    for (;;) {
      await clock.sleep(ms, signal)
      if (signal.aborted) return
      yield tick++
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

/** Runs the task when the stream is first read and streams what it gives; a failed task gives nothing. */
export const fromTask = <A, E, R>(task: T.Task<Stream<A>, E, R>, env: R, signal: AbortSignal): Stream<A> => ({
  async *[Symbol.asyncIterator]() {
    const exit = await task.run(env, signal)
    if (isOk(exit)) yield* exit.value
  },
})

/**
 * A stream written as a task. The task runs when the stream is first read, and each `emit` hands the
 * reader one element and resumes once the reader asks for the next. The task is interrupted when the
 * reader stops or the signal aborts, which ends the stream; a failure or defect ends the read with a
 * TaskError.
 */
export const fromEmitter = <A, E, R>(
  body: (emit: (element: A) => T.Task<void>) => T.Task<unknown, E, R>,
  env: R,
  signal: AbortSignal,
): Stream<A> => ({
  async *[Symbol.asyncIterator]() {
    const stop = new AbortController()
    const onAbort = () => stop.abort()
    if (signal.aborted) stop.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
    let offered = offering<A, E>()
    const emit = (element: A): T.Task<void> =>
      T.async<void>((resume) => {
        offered.resolve({ _tag: 'Element', element, taken: () => resume(ok(undefined)) })
        return () => {}
      })
    const finished = body(emit)
      .run(env, stop.signal)
      .then((exit) => offered.resolve({ _tag: 'End', exit }))
    try {
      for (;;) {
        const offer = await offered.promise
        if (offer._tag === 'End') {
          if (isOk(offer.exit) || offer.exit.error._tag === 'Interrupt') return
          throw new T.TaskError(offer.exit.error)
        }
        offered = offering()
        yield offer.element
        offer.taken()
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      stop.abort()
      await finished
    }
  },
})

/** Calls the finalizer once a stream that was read ends, fails, or its reader stops. */
export const ensuring =
  (finalizer: () => void) =>
  <A>(source: Stream<A>): Stream<A> => ({
    async *[Symbol.asyncIterator]() {
      try {
        yield* source
      } finally {
        finalizer()
      }
    },
  })

// The source is asked to close but never awaited: a pull that never settles must not hold the consumer.
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

export const toArray = <A>(source: Stream<A>): T.Task<A[]> =>
  T.promise(async (signal) => {
    const out: A[] = []
    for await (const a of untilAborted(signal)(source)) out.push(a)
    return out
  })

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

type Offer<A, E> =
  | { readonly _tag: 'Element'; readonly element: A; readonly taken: () => void }
  | { readonly _tag: 'End'; readonly exit: T.Exit<unknown, E> }

const offering = <A, E>(): {
  readonly promise: Promise<Offer<A, E>>
  readonly resolve: (offer: Offer<A, E>) => void
} => {
  let resolve!: (offer: Offer<A, E>) => void
  const promise = new Promise<Offer<A, E>>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

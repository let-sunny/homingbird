import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Stream as S, Task as T, makePubSub, makeQueue, makeTestClock, ok, pipe } from '../src/index.ts'
import { failed, flush, interrupted, isSettled } from './helpers.ts'

const collect = <A>(source: S.Stream<A>): Promise<A[]> => T.runPromise(S.toArray(source))

const tracked = <A>(items: ReadonlyArray<A>) => {
  const state = { closed: 0, pulled: 0 }
  const source: S.Stream<A> = {
    async *[Symbol.asyncIterator]() {
      try {
        for (const item of items) {
          state.pulled++
          yield item
        }
      } finally {
        state.closed++
      }
    },
  }
  return { state, source }
}

describe('sources', () => {
  it('fromIterable, of and empty emit their items', async () => {
    expect(await collect(S.fromIterable(new Set([1, 2])))).toEqual([1, 2])
    expect(await collect(S.of('a', 'b'))).toEqual(['a', 'b'])
    expect(await collect(S.empty)).toEqual([])
  })

  it('interval ticks on the clock until its signal aborts', async () => {
    const clock = makeTestClock()
    const controller = new AbortController()
    const seen: number[] = []
    const reading = (async () => {
      for await (const tick of S.interval(clock, 10, controller.signal)) seen.push(tick)
    })()
    await clock.advance(35)
    expect(seen).toEqual([0, 1, 2])
    controller.abort()
    await reading
    expect(clock.pending()).toBe(0)
  })

  it('interval stops when its consumer stops', async () => {
    const clock = makeTestClock()
    const reading = (async () => {
      for await (const tick of S.interval(clock, 10, new AbortController().signal)) return tick
    })()
    await clock.advance(10)
    expect(await reading).toBe(0)
  })
})

describe('combinators agree with their array equivalents', () => {
  const numbers = fc.array(fc.integer({ min: -50, max: 50 }), { maxLength: 30 })

  it('map, filter, flatMap, scan and concat', async () => {
    await fc.assert(
      fc.asyncProperty(numbers, numbers, async (xs, ys) => {
        const source = () => S.fromIterable(xs)
        expect(await collect(S.map((n: number) => n * 2)(source()))).toEqual(xs.map((n) => n * 2))
        expect(await collect(S.map(async (n: number) => n + 1)(source()))).toEqual(xs.map((n) => n + 1))
        expect(await collect(S.filter((n: number) => n % 2 === 0)(source()))).toEqual(
          xs.filter((n) => n % 2 === 0),
        )
        expect(await collect(S.flatMap((n: number) => [n, n])(source()))).toEqual(xs.flatMap((n) => [n, n]))
        expect(await collect(S.flatMap((n: number) => S.of(n))(source()))).toEqual(xs)
        const sums: number[] = []
        xs.reduce((sum, n) => {
          sums.push(sum + n)
          return sum + n
        }, 0)
        expect(await collect(S.scan(0, (sum: number, n: number) => sum + n)(source()))).toEqual(sums)
        expect(await collect(S.concat(S.fromIterable(ys), S.of(0))(source()))).toEqual([...xs, ...ys, 0])
      }),
      { numRuns: 50 },
    )
  })

  it('take and takeWhile', async () => {
    await fc.assert(
      fc.asyncProperty(numbers, fc.integer({ min: -2, max: 35 }), async (xs, n) => {
        expect(await collect(S.take(n)(S.fromIterable(xs)))).toEqual(xs.slice(0, Math.max(0, n)))
        const firstNegative = xs.findIndex((x) => x < 0)
        expect(await collect(S.takeWhile((x: number) => x >= 0)(S.fromIterable(xs)))).toEqual(
          firstNegative === -1 ? xs : xs.slice(0, firstNegative),
        )
      }),
      { numRuns: 50 },
    )
  })

  it('filter narrows with a type guard', async () => {
    const mixed = S.of<number | string>(1, 'a', 2)
    const onlyNumbers: S.Stream<number> = S.filter(
      (x: number | string): x is number => typeof x === 'number',
    )(mixed)
    expect(await collect(onlyNumbers)).toEqual([1, 2])
  })
})

describe('demand and teardown', () => {
  it('take stops pulling and closes the source once it has enough', async () => {
    const { state, source } = tracked([1, 2, 3, 4])
    expect(await collect(S.take(2)(source))).toEqual([1, 2])
    expect(state).toEqual({ closed: 1, pulled: 2 })
    const untouched = tracked([1])
    expect(await collect(S.take(0)(untouched.source))).toEqual([])
    expect(untouched.state.pulled).toBe(0)
  })

  it('merge interleaves by arrival, keeps each source’s order, and ends when all have ended', async () => {
    const a = makeQueue<string>()
    const b = makeQueue<string>()
    const reading = collect(S.merge(a, b))
    a.tryOffer('a1')
    await flush()
    b.tryOffer('b1')
    await flush()
    a.tryOffer('a2')
    a.close()
    await flush()
    b.tryOffer('b2')
    b.close()
    expect(await reading).toEqual(['a1', 'b1', 'a2', 'b2'])
    expect(await collect(S.merge())).toEqual([])
  })

  it('merge delivers every item of every source', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(fc.integer(), { maxLength: 8 }), { maxLength: 5 }),
        async (lists) => {
          const merged = await collect(S.merge(...lists.map((list) => S.fromIterable(list))))
          expect([...merged].sort((x, y) => x - y)).toEqual(lists.flat().sort((x, y) => x - y))
        },
      ),
      { numRuns: 50 },
    )
  })

  it('closing a merged stream closes every source, even one whose return rejects', async () => {
    const pubsub = makePubSub<number>()
    const live = pubsub.subscribe()
    const rude: S.Stream<number> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
        return: () => Promise.reject(new Error('rude')),
      }),
    }
    pubsub.publish(1)
    for await (const item of S.merge(live, rude)) {
      expect(item).toBe(1)
      break
    }
    await flush()
    expect(pubsub.subscriberCount()).toBe(0)
  })

  it('untilAborted ends at once when the signal aborts mid-pull and asks the source to close', async () => {
    const controller = new AbortController()
    let closed = 0
    const endless: S.Stream<number> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
        return: async () => {
          closed++
          return { done: true, value: undefined }
        },
      }),
    }
    const reading = collect(S.untilAborted(controller.signal)(endless))
    expect(await isSettled(reading)).toBe(false)
    controller.abort()
    expect(await reading).toEqual([])
    expect(closed).toBe(1)
  })

  it('untilAborted passes items through, ends with the source, and stays ended', async () => {
    const controller = new AbortController()
    const iterator = S.untilAborted(controller.signal)(S.of(1))[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: 1 })
    expect((await iterator.next()).done).toBe(true)
    expect((await iterator.next()).done).toBe(true)
    expect((await iterator.return!()).done).toBe(true)

    const aborted = new AbortController()
    aborted.abort()
    expect(await collect(S.untilAborted(aborted.signal)(S.of(1, 2)))).toEqual([])
  })

  it('untilAborted drops an item that arrives together with the abort, and survives a rejecting return', async () => {
    const controller = new AbortController()
    const racing: S.Stream<number> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          controller.abort()
          return { done: false, value: 1 }
        },
        return: () => Promise.reject(new Error('rude')),
      }),
    }
    expect(await collect(S.untilAborted(controller.signal)(racing))).toEqual([])
    await flush()
  })

  it('untilAborted propagates a source error once and then stays ended', async () => {
    const boom = new Error('source failed')
    const failing: S.Stream<number> = {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(boom) }),
    }
    const iterator = S.untilAborted(new AbortController().signal)(failing)[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toBe(boom)
    expect((await iterator.next()).done).toBe(true)
  })

  it('untilAborted tolerates a source without return', async () => {
    const controller = new AbortController()
    const bare: S.Stream<number> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }
    const reading = collect(S.untilAborted(controller.signal)(bare))
    await flush()
    controller.abort()
    expect(await reading).toEqual([])
  })
})

describe('running a stream as a task', () => {
  it('toArray is interruptible', async () => {
    const controller = new AbortController()
    const running = T.run(S.toArray(makeQueue<number>()), undefined, controller.signal)
    await flush()
    controller.abort()
    expect(await running).toEqual(interrupted)
  })

  it('forEach runs a task per item in order and stops at the first failure', async () => {
    const seen: number[] = []
    const record = S.forEach((n: number) => (n === 3 ? T.fail('three') : T.sync(() => seen.push(n))))
    expect(await T.run(record(S.of(1, 2)))).toEqual(ok(undefined))
    const { state, source } = tracked([1, 2, 3, 4])
    expect(await T.run(record(source))).toEqual(failed('three'))
    expect(seen).toEqual([1, 2, 1, 2])
    expect(state.closed).toBe(1)
  })

  it('forEach is interrupted with its caller and closes the stream', async () => {
    const controller = new AbortController()
    const pubsub = makePubSub<number>()
    const seen: number[] = []
    const running = T.run(
      pipe(
        pubsub.subscribe(),
        S.forEach((n: number) => T.sync(() => seen.push(n))),
      ),
      undefined,
      controller.signal,
    )
    pubsub.publish(1)
    await flush()
    controller.abort()
    expect(await running).toEqual(interrupted)
    expect(seen).toEqual([1])
    await flush()
    expect(pubsub.subscriberCount()).toBe(0)
  })
})

describe('streams built from tasks and with cleanup', () => {
  it('fromTask runs its task only when read, and streams what it gives', async () => {
    let runs = 0
    const later = S.fromTask(
      T.sync(() => {
        runs++
        return S.of(1, 2)
      }),
      undefined,
      new AbortController().signal,
    )
    expect(runs).toBe(0)
    expect(await collect(later)).toEqual([1, 2])
    expect(runs).toBe(1)
  })

  it('fromTask gives nothing when its task fails or is interrupted', async () => {
    const signal = new AbortController().signal
    expect(await collect(S.fromTask(T.fail('gone'), undefined, signal))).toEqual([])
    const aborted = new AbortController()
    aborted.abort()
    expect(await collect(S.fromTask(T.succeed(S.of(1)), undefined, aborted.signal))).toEqual([])
  })

  it('fromTask runs its task in the environment it was given', async () => {
    const read = S.fromTask(
      T.map((env: { readonly items: number[] }) => S.fromIterable(env.items))(
        T.ask<{ readonly items: number[] }>(),
      ),
      { items: [3, 4] },
      new AbortController().signal,
    )
    expect(await collect(read)).toEqual([3, 4])
  })

  it('ensuring calls its finalizer once when the stream ends, and not before it is read', async () => {
    let finalized = 0
    const source = S.ensuring(() => finalized++)(S.of(1, 2))
    expect(finalized).toBe(0)
    expect(await collect(source)).toEqual([1, 2])
    expect(finalized).toBe(1)
  })

  it('ensuring calls its finalizer when the reader stops early or the source fails', async () => {
    let finalized = 0
    const { state, source } = tracked([1, 2, 3])
    expect(
      await collect(
        pipe(
          source,
          S.ensuring(() => finalized++),
          S.take(1),
        ),
      ),
    ).toEqual([1])
    expect(finalized).toBe(1)
    expect(state.closed).toBe(1)
    const failing: S.Stream<number> = {
      async *[Symbol.asyncIterator]() {
        yield 1
        throw new Error('broken')
      },
    }
    await expect(collect(S.ensuring(() => finalized++)(failing))).rejects.toThrow()
    expect(finalized).toBe(2)
  })
})

describe('streams written as tasks', () => {
  const never = new AbortController().signal

  it('fromEmitter runs its task only when read and streams what it emits, in order', async () => {
    let runs = 0
    const counted = S.fromEmitter(
      (emit) =>
        T.gen(function* () {
          runs++
          yield* emit(1)
          yield* emit(2)
          yield* emit(3)
        }),
      undefined,
      never,
    )
    expect(runs).toBe(0)
    expect(await collect(counted)).toEqual([1, 2, 3])
    expect(runs).toBe(1)
  })

  it('fromEmitter waits for the reader before going on past an emit', async () => {
    const steps: string[] = []
    const source = S.fromEmitter(
      (emit) =>
        T.gen(function* () {
          steps.push('before')
          yield* emit('a')
          steps.push('after a')
          yield* emit('b')
          steps.push('after b')
        }),
      undefined,
      never,
    )
    const reader = source[Symbol.asyncIterator]()
    expect(await reader.next()).toEqual({ done: false, value: 'a' })
    await flush()
    expect(steps).toEqual(['before'])
    expect(await reader.next()).toEqual({ done: false, value: 'b' })
    expect(steps).toEqual(['before', 'after a'])
    expect(await reader.next()).toEqual({ done: true, value: undefined })
    expect(steps).toEqual(['before', 'after a', 'after b'])
  })

  it('fromEmitter runs its task in the environment it was given', async () => {
    const source = S.fromEmitter(
      (emit) =>
        T.flatMap((env: { readonly item: string }) => emit(env.item))(T.ask<{ readonly item: string }>()),
      { item: 'from env' },
      never,
    )
    expect(await collect(source)).toEqual(['from env'])
  })

  it('fromEmitter interrupts its task and waits for its cleanup when the reader stops', async () => {
    const events: string[] = []
    const source = S.fromEmitter(
      (emit) =>
        T.gen(function* () {
          try {
            for (let n = 0; ; n++) yield* emit(n)
          } finally {
            events.push('cleaned')
          }
        }),
      undefined,
      never,
    )
    for await (const n of source) if (n === 2) break
    expect(events).toEqual(['cleaned'])
  })

  it('fromEmitter ends when its signal aborts, while the reader waits or holds an element', async () => {
    const waiting = new AbortController()
    const quiet = S.fromEmitter(() => T.never, undefined, waiting.signal)
    const read = quiet[Symbol.asyncIterator]().next()
    await flush()
    expect(await isSettled(read)).toBe(false)
    waiting.abort()
    expect(await read).toEqual({ done: true, value: undefined })

    const holding = new AbortController()
    const endless = S.fromEmitter(
      (emit) =>
        T.gen(function* () {
          for (;;) yield* emit('again')
        }),
      undefined,
      holding.signal,
    )
    const reader = endless[Symbol.asyncIterator]()
    expect(await reader.next()).toEqual({ done: false, value: 'again' })
    holding.abort()
    expect(await reader.next()).toEqual({ done: true, value: undefined })
  })

  it('fromEmitter gives nothing and runs nothing past the start when its signal is already aborted', async () => {
    const aborted = new AbortController()
    aborted.abort()
    let emitted = 0
    const source = S.fromEmitter(
      (emit) =>
        T.gen(function* () {
          emitted++
          yield* emit(1)
        }),
      undefined,
      aborted.signal,
    )
    expect(await collect(source)).toEqual([])
    expect(emitted).toBe(0)
  })

  it('fromEmitter ends the read with a TaskError when its task fails or dies', async () => {
    const failing = S.fromEmitter(
      (emit: (n: number) => T.Task<void>) =>
        T.gen(function* () {
          yield* emit(1)
          return yield* T.fail('gone')
        }),
      undefined,
      never,
    )
    const seen: number[] = []
    const reading = (async () => {
      for await (const n of failing) seen.push(n)
    })()
    await expect(reading).rejects.toMatchObject({ name: 'TaskError', cause: { _tag: 'Fail', error: 'gone' } })
    expect(seen).toEqual([1])
    const dying = S.fromEmitter(() => T.die(new Error('broken')), undefined, never)
    await expect(dying[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      cause: { _tag: 'Die' },
    })
  })

  it('fromEmitter stops listening to its signal once the read ends', async () => {
    const controller = new AbortController()
    const removed: string[] = []
    const signal = controller.signal
    const remove = signal.removeEventListener.bind(signal)
    signal.removeEventListener = (type: string, listener: never, options?: never) => {
      removed.push(type)
      remove(type, listener, options)
    }
    expect(await collect(S.fromEmitter((emit) => emit(1), undefined, signal))).toEqual([1])
    expect(removed).toEqual(['abort'])
  })
})

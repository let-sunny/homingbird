import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  QueueClosed,
  Task as T,
  makeDeferred,
  makeMutex,
  makePubSub,
  makeQueue,
  makeSemaphore,
  ok,
} from '../src/index.ts'
import { failed, flush, interrupted, isSettled, setup } from './helpers.ts'

const collect = async <A>(source: AsyncIterable<A>): Promise<A[]> => {
  const out: A[] = []
  for await (const item of source) out.push(item)
  return out
}

describe('Deferred', () => {
  it('wakes every waiter with the value, and later waiters at once', async () => {
    const deferred = makeDeferred<number>()
    const early = [T.run(deferred.wait), T.run(deferred.wait)]
    await flush()
    expect(deferred.isDone()).toBe(false)
    expect(deferred.resolve(7)).toBe(true)
    expect(deferred.resolve(8)).toBe(false)
    expect(deferred.isDone()).toBe(true)
    expect(await Promise.all(early)).toEqual([ok(7), ok(7)])
    expect(await T.run(deferred.wait)).toEqual(ok(7))
  })

  it('forgets a waiter that was interrupted', async () => {
    const deferred = makeDeferred<number>()
    const controller = new AbortController()
    const waiting = T.run(deferred.wait, undefined, controller.signal)
    await flush()
    controller.abort()
    expect(await waiting).toEqual(interrupted)
    expect(deferred.resolve(1)).toBe(true)
  })
})

describe('Semaphore', () => {
  it('refuses a permit count that is not a positive integer', () => {
    for (const permits of [0, -1, 1.5, Number.NaN]) expect(() => makeSemaphore(permits)).toThrow(RangeError)
  })

  it('never lets more tasks hold a permit than it has', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 10 }),
        async (permits, count) => {
          const { clock, env } = setup()
          const semaphore = makeSemaphore(permits)
          let holding = 0
          let peak = 0
          const job = semaphore.withPermit(
            T.gen(function* () {
              peak = Math.max(peak, ++holding)
              yield* T.sleep(10)
              holding--
            }),
          )
          const running = T.run(T.all(Array.from({ length: count }, () => job)), env)
          await clock.advance(10 * (count + 1))
          expect((await running)._tag).toBe('Ok')
          expect(peak).toBe(Math.min(permits, count))
          expect(semaphore.available()).toBe(permits)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('releases the permit when the holder fails or is interrupted', async () => {
    const { clock, env } = setup()
    const mutex = makeMutex()
    expect(await T.run(mutex.withPermit(T.fail('e')))).toEqual(failed('e'))
    expect(mutex.available()).toBe(1)
    const controller = new AbortController()
    const holder = T.run(mutex.withPermit(T.sleep(100)), env, controller.signal)
    await clock.flush()
    expect(mutex.available()).toBe(0)
    controller.abort()
    expect(await holder).toEqual(interrupted)
    expect(mutex.available()).toBe(1)
  })

  it('hands the permit to waiters in order and drops a waiter that gave up', async () => {
    const { clock, env } = setup()
    const mutex = makeMutex()
    const order: string[] = []
    const job = (name: string) => mutex.withPermit(T.map(() => order.push(name))(T.sleep(10)))
    const first = T.run(job('first'), env)
    const impatient = new AbortController()
    const second = T.run(job('second'), env, impatient.signal)
    const third = T.run(job('third'), env)
    await clock.flush()
    impatient.abort()
    expect(await second).toEqual(interrupted)
    await clock.advance(20)
    await Promise.all([first, third])
    expect(order).toEqual(['first', 'third'])
    expect(mutex.available()).toBe(1)
  })
})

describe('Queue', () => {
  it('refuses a capacity below one', () => {
    expect(() => makeQueue(0)).toThrow(RangeError)
  })

  it('is first-in first-out for any interleaving of offers and takes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { maxLength: 40 }), async (operations) => {
        const queue = makeQueue<number>()
        const model: number[] = []
        let next = 0
        for (const isOffer of operations) {
          if (isOffer) {
            model.push(next)
            expect(await T.run(queue.offer(next++))).toEqual(ok(undefined))
          } else if (model.length > 0) {
            expect(await T.run(queue.take)).toEqual(ok(model.shift()))
          }
          expect(queue.size()).toBe(model.length)
        }
      }),
    )
  })

  it('makes an offer wait while the queue is full, and admits it when room appears', async () => {
    const queue = makeQueue<string>(1)
    expect(queue.tryOffer('a')).toBe(true)
    expect(queue.tryOffer('b')).toBe(false)
    const waiting = T.run(queue.offer('b'))
    expect(await isSettled(waiting)).toBe(false)
    expect(await T.run(queue.take)).toEqual(ok('a'))
    expect(await waiting).toEqual(ok(undefined))
    expect(await T.run(queue.take)).toEqual(ok('b'))
  })

  it('hands an item straight to a waiting taker, even at capacity', async () => {
    const queue = makeQueue<number>(1)
    const takers = [T.run(queue.take), T.run(queue.take)]
    await flush()
    expect(queue.tryOffer(1)).toBe(true)
    expect(queue.tryOffer(2)).toBe(true)
    expect(queue.size()).toBe(0)
    expect(await Promise.all(takers)).toEqual([ok(1), ok(2)])
  })

  it('forgets takers and offerers that were interrupted', async () => {
    const queue = makeQueue<number>(1)
    const taker = new AbortController()
    const taking = T.run(queue.take, undefined, taker.signal)
    await flush()
    taker.abort()
    expect(await taking).toEqual(interrupted)
    queue.tryOffer(1)
    expect(queue.size()).toBe(1)

    const offerer = new AbortController()
    const offering = T.run(queue.offer(2), undefined, offerer.signal)
    await flush()
    offerer.abort()
    expect(await offering).toEqual(interrupted)
    expect(await T.run(queue.take)).toEqual(ok(1))
    expect(queue.size()).toBe(0)
  })

  it('after close refuses offers, drains what is queued, then fails takes', async () => {
    const queue = makeQueue<number>(1)
    queue.tryOffer(1)
    const blockedOffer = T.run(queue.offer(2))
    await flush()
    queue.close()
    queue.close()
    expect(queue.isClosed()).toBe(true)
    expect(await blockedOffer).toEqual(failed(QueueClosed()))
    expect(queue.tryOffer(3)).toBe(false)
    expect(await T.run(queue.offer(3))).toEqual(failed(QueueClosed()))
    expect(await T.run(queue.take)).toEqual(ok(1))
    expect(await T.run(queue.take)).toEqual(failed(QueueClosed()))
  })

  it('wakes waiting takers when it closes', async () => {
    const queue = makeQueue<number>()
    const taking = T.run(queue.take)
    await flush()
    queue.close()
    expect(await taking).toEqual(failed(QueueClosed()))
  })

  it('iterates until closed and drained, and stops a pending pull on return', async () => {
    const queue = makeQueue<number>()
    queue.tryOffer(1)
    queue.tryOffer(2)
    queue.close()
    expect(await collect(queue)).toEqual([1, 2])

    const open = makeQueue<number>()
    const iterator = open[Symbol.asyncIterator]()
    const pending = iterator.next()
    expect(await isSettled(pending)).toBe(false)
    expect(await iterator.return!()).toEqual({ done: true, value: undefined })
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(open.tryOffer(9)).toBe(true)
    expect(open.size()).toBe(1)
  })
})

describe('PubSub', () => {
  it('delivers every message to every current subscriber, and none from before it subscribed', async () => {
    const pubsub = makePubSub<number>()
    pubsub.publish(0)
    const a = pubsub.subscribe()
    pubsub.publish(1)
    const b = pubsub.subscribe()
    pubsub.publish(2)
    expect(pubsub.subscriberCount()).toBe(2)
    a.close()
    b.close()
    expect(await collect(a)).toEqual([1, 2])
    expect(await collect(b)).toEqual([2])
    expect(pubsub.subscriberCount()).toBe(0)
    expect([a.overflowed(), b.overflowed()]).toEqual([false, false])
  })

  it('cuts off a subscriber that falls behind without disturbing the others', async () => {
    const pubsub = makePubSub<number>()
    const slow = pubsub.subscribe({ capacity: 2 })
    const fast = pubsub.subscribe({ capacity: 10 })
    for (const n of [1, 2, 3, 4]) pubsub.publish(n)
    expect(slow.overflowed()).toBe(true)
    expect(pubsub.subscriberCount()).toBe(1)
    expect(await collect(slow)).toEqual([1, 2])
    fast.close()
    expect(await collect(fast)).toEqual([1, 2, 3, 4])
  })

  it('ends a subscription when its signal aborts, or at once if it already had', async () => {
    const pubsub = makePubSub<number>()
    const controller = new AbortController()
    const live = pubsub.subscribe({ signal: controller.signal })
    const reading = collect(live)
    pubsub.publish(1)
    controller.abort()
    expect(await reading).toEqual([1])
    expect(pubsub.subscriberCount()).toBe(0)

    const late = pubsub.subscribe({ signal: controller.signal })
    expect(pubsub.subscriberCount()).toBe(0)
    expect(await collect(late)).toEqual([])
  })

  it('unsubscribes when the consumer stops iterating', async () => {
    const pubsub = makePubSub<number>()
    const subscription = pubsub.subscribe()
    pubsub.publish(1)
    for await (const _ of subscription) break
    expect(pubsub.subscriberCount()).toBe(0)
  })
})

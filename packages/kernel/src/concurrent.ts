/**
 * Coordination primitives. Every wait is a Task, so every wait can be interrupted, and an
 * interrupted waiter leaves no trace behind.
 */
import { type Tagged, tagged } from './data.ts'
import { type Option, none, some } from './option.ts'
import { err, ok } from './result.ts'
import * as T from './task.ts'

// ---------------------------------------------------------------------------------------------
// Deferred
// ---------------------------------------------------------------------------------------------

export interface Deferred<A> {
  /** Waits for the value. */
  readonly wait: T.Task<A>
  /** Completes the deferred. Returns false if it was already complete. */
  readonly resolve: (value: A) => boolean
  readonly isDone: () => boolean
}

export const makeDeferred = <A>(): Deferred<A> => {
  let state: Option<A> = none
  const waiters = new Set<(value: A) => void>()
  return {
    wait: T.suspend(() =>
      state._tag === 'Some'
        ? T.succeed(state.value)
        : T.async<A>((resume) => {
            const waiter = (value: A) => resume(ok(value))
            waiters.add(waiter)
            return () => waiters.delete(waiter)
          }),
    ),
    resolve: (value) => {
      if (state._tag === 'Some') return false
      state = some(value)
      for (const waiter of waiters) waiter(value)
      waiters.clear()
      return true
    },
    isDone: () => state._tag === 'Some',
  }
}

// ---------------------------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------------------------

export interface Semaphore {
  /** Runs the task while holding a permit. The permit is released whatever the outcome. */
  readonly withPermit: <A, E, R>(task: T.Task<A, E, R>) => T.Task<A, E, R>
  readonly available: () => number
}

export const makeSemaphore = (permits: number): Semaphore => {
  if (!Number.isInteger(permits) || permits < 1) throw new RangeError('permits must be a positive integer')
  let free = permits
  const waiters: Array<() => void> = []
  const acquire: T.Task<void> = T.suspend(() => {
    if (free > 0) {
      free--
      return T.unit
    }
    return T.async<void>((resume) => {
      const waiter = () => resume(ok(undefined))
      waiters.push(waiter)
      return () => {
        waiters.splice(waiters.indexOf(waiter), 1)
      }
    })
  })
  const release = T.sync(() => {
    const next = waiters.shift()
    if (next) next()
    else free++
  })
  return {
    withPermit: (task) =>
      T.bracket(
        acquire,
        () => task,
        () => release,
      ),
    available: () => free,
  }
}

/** A semaphore with one permit. */
export const makeMutex = (): Semaphore => makeSemaphore(1)

// ---------------------------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------------------------

export const QueueClosed = tagged('QueueClosed')()
export type QueueClosed = ReturnType<typeof QueueClosed>

export interface Queue<A> extends AsyncIterable<A> {
  /** Adds an item, waiting while the queue is full. Fails once the queue is closed. */
  readonly offer: (item: A) => T.Task<void, QueueClosed>
  /** Adds an item if there is room. Returns false when full or closed. */
  readonly tryOffer: (item: A) => boolean
  /** Removes the oldest item, waiting while the queue is empty. Fails once closed and drained. */
  readonly take: T.Task<A, QueueClosed>
  /** Stops accepting items. Items already queued can still be taken. */
  readonly close: () => void
  readonly size: () => number
  readonly isClosed: () => boolean
}

/** A bounded FIFO queue with backpressure. */
export const makeQueue = <A>(capacity = Number.POSITIVE_INFINITY): Queue<A> => {
  if (capacity < 1) throw new RangeError('capacity must be at least 1')
  const items: A[] = []
  let closed = false
  const takers: Array<(exit: T.Exit<A, QueueClosed>) => void> = []
  const offerers: Array<{ item: A; resume: (exit: T.Exit<void, QueueClosed>) => void }> = []
  const closedExit = err(T.failCause(QueueClosed()))

  const admit = (item: A): void => {
    const taker = takers.shift()
    if (taker) taker(ok(item))
    else items.push(item)
  }
  const refill = (): void => {
    const waiting = offerers.shift()
    if (!waiting) return
    items.push(waiting.item)
    waiting.resume(ok(undefined))
  }

  const tryOffer = (item: A): boolean => {
    if (closed || (items.length >= capacity && takers.length === 0)) return false
    admit(item)
    return true
  }

  const take: T.Task<A, QueueClosed> = T.suspend(() => {
    if (items.length > 0) {
      const item = items.shift() as A
      refill()
      return T.succeed(item)
    }
    if (closed) return T.fail(QueueClosed())
    return T.async<A, QueueClosed>((resume) => {
      takers.push(resume)
      return () => {
        takers.splice(takers.indexOf(resume), 1)
      }
    })
  })

  return {
    tryOffer,
    offer: (item) =>
      T.suspend(() => {
        if (closed) return T.fail(QueueClosed())
        if (tryOffer(item)) return T.unit
        return T.async<void, QueueClosed>((resume) => {
          const waiting = { item, resume }
          offerers.push(waiting)
          return () => {
            offerers.splice(offerers.indexOf(waiting), 1)
          }
        })
      }),
    take,
    close: () => {
      if (closed) return
      closed = true
      for (const taker of takers.splice(0)) taker(closedExit)
      for (const waiting of offerers.splice(0)) waiting.resume(closedExit)
    },
    size: () => items.length,
    isClosed: () => closed,
    [Symbol.asyncIterator](): AsyncIterator<A> {
      const controller = new AbortController()
      const done: IteratorResult<A> = { done: true, value: undefined }
      return {
        next: async () => {
          const exit = await take.run(undefined, controller.signal)
          return exit._tag === 'Ok' ? { done: false, value: exit.value } : done
        },
        return: async () => {
          controller.abort()
          return done
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------------------------
// PubSub
// ---------------------------------------------------------------------------------------------

export interface Subscription<A> extends AsyncIterable<A> {
  /** Ends the subscription; its iterator completes after delivering what is already buffered. */
  readonly close: () => void
  /** True when the subscriber fell behind and lost messages. */
  readonly overflowed: () => boolean
}

export interface SubscribeOptions {
  /** Messages buffered for a slow subscriber before it is cut off. Defaults to 1024. */
  readonly capacity?: number
  /** Closes the subscription when this signal aborts. */
  readonly signal?: AbortSignal
}

export interface PubSub<A> {
  /** Delivers to every current subscriber. Never blocks; a subscriber that overflows is closed. */
  readonly publish: (message: A) => void
  readonly subscribe: (options?: SubscribeOptions) => Subscription<A>
  readonly subscriberCount: () => number
}

/**
 * Fan-out to independent subscribers. A slow subscriber cannot stall the publisher or its peers:
 * when its buffer is full it is closed and flagged as overflowed, and is expected to resubscribe
 * and catch up from durable state.
 */
export const makePubSub = <A>(): PubSub<A> => {
  const queues = new Set<{ queue: Queue<A>; overflow: () => void }>()
  return {
    publish: (message) => {
      for (const entry of queues) {
        if (entry.queue.tryOffer(message)) continue
        entry.overflow()
      }
    },
    subscribe: (options = {}) => {
      const queue = makeQueue<A>(options.capacity ?? 1024)
      let overflowed = false
      const close = () => {
        queues.delete(entry)
        queue.close()
        options.signal?.removeEventListener('abort', close)
      }
      const entry = {
        queue,
        overflow: () => {
          overflowed = true
          close()
        },
      }
      if (options.signal?.aborted) queue.close()
      else {
        queues.add(entry)
        options.signal?.addEventListener('abort', close, { once: true })
      }
      return {
        close,
        overflowed: () => overflowed,
        [Symbol.asyncIterator]: () => {
          const it = queue[Symbol.asyncIterator]()
          return {
            next: () => it.next(),
            return: async () => {
              close()
              return it.return!()
            },
          }
        },
      }
    },
    subscriberCount: () => queues.size,
  }
}

export type { Tagged }

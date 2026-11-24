import { type Clock, type Deferred, Task as T, makeDeferred } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'
import { type ReadableSignal, type Signal, batch, later, signal } from '@homingbird/ui'
import { QUIET_RETRY_SECONDS, growingSlow, retryWaits } from './load-timing.ts'
import { isTransient } from './refusals.ts'

/**
 * Something of the server's that several places show: one value, asked for by one request at a time. What
 * asks while a request runs is served by one more after it, however many ask, so an older answer never
 * replaces a newer one. A change made while a request runs is made again on its answer.
 *
 * A failed request keeps the value only while the server is away or too busy. Any refusal empties it,
 * since what the person may no longer read must not stay shown (rules 2 and 6).
 */
export const resource = <A>(empty: A): Resource<A> => {
  const value = signal(empty)
  const load = signal<Load>(NOT_ASKED)
  let run: Run<A> | null = null
  let next: Deferred<boolean> | null = null
  let newestAnswerAskedAt = Number.NEGATIVE_INFINITY
  let cancelRepair = (): void => {}

  const change = (made: (current: A) => A): void => {
    run?.changes.push(made)
    value.set(made(value.get()))
  }

  const afterRunning = (): Deferred<boolean> => {
    next ??= makeDeferred<boolean>()
    return next
  }

  const askNext = (source: Source<A>): Deferred<boolean> => {
    const asked = afterRunning()
    if (run === null) start(source, 'told')
    return asked
  }

  const start = (source: Source<A>, telling: Telling): void => {
    cancelRepair()
    if (source.ended.aborted) {
      endWaiting()
      return
    }
    const own: Run<A> = { changes: [], waiting: null, isResting: false, interrupt: () => {} }
    run = own
    if (telling === 'told') load.update((now) => ({ ...now, step: 'loading' }))
    const task = T.map((exit: T.Exit<void, never>) => settleBroken(source, own, exit))(
      T.exit(attempts(source, own, telling)),
    )
    const running = T.runFork(task, { clock: source.clock }, source.ended)
    own.interrupt = () => void running.interrupt()
  }

  const attempts = (source: Source<A>, own: Run<A>, telling: Telling) =>
    T.scoped((scope) =>
      T.gen(function* () {
        if (telling === 'told') yield* scope.fork(growingSlow(sayWhileNotLoaded))
        const waits = telling === 'told' ? [...retryWaits()] : []
        while (run === own) {
          const waiting = beginAttempt(own)
          const askedAt = source.clock.now()
          const answer = yield* T.result(source.ask)
          if (run !== own) return
          const wait = answer._tag === 'Err' && isTransient(answer.error) ? waits.shift() : undefined
          if (wait === undefined) {
            run = null
            if (answer._tag === 'Ok') apply(answer.value, own, askedAt)
            else if (isTransient(answer.error)) keep(source, answer.error)
            else clear(answer.error)
          }
          own.waiting = null
          waiting.resolve(answer._tag === 'Ok')
          if (answer._tag === 'Ok') source.answered(askedAt)
          else source.failed(answer.error)
          if (wait === undefined) return startNext(source)
          own.isResting = true
          yield* T.sleep(wait)
        }
      }),
    )

  const beginAttempt = (own: Run<A>): Deferred<boolean> => {
    const waiting = afterRunning()
    next = null
    own.waiting = waiting
    own.changes = []
    own.isResting = false
    return waiting
  }

  const startNext = (source: Source<A>): void => {
    if (run === null && next !== null) start(source, 'told')
  }

  const apply = (answer: A, own: Run<A>, askedAt: number): void => {
    newestAnswerAskedAt = askedAt
    batch(() => {
      value.set(own.changes.reduce((current, made) => made(current), answer))
      load.set({ loaded: true, step: 'idle', error: null })
    })
  }

  const keep = (source: Source<A>, error: ApiError): void => {
    load.update(({ loaded }) => ({ loaded, step: 'failed', error }))
    cancelRepair = later(source.clock, QUIET_RETRY_SECONDS * 1000, () => start(source, 'quiet'))
  }

  const clear = (error: ApiError | null): void =>
    batch(() => {
      value.set(empty)
      load.set({ loaded: false, step: 'failed', error })
    })

  const settleBroken = (source: Source<A>, own: Run<A>, exit: T.Exit<void, never>): void => {
    if (exit._tag === 'Ok') return
    own.waiting?.resolve(false)
    if (run === own) {
      run = null
      clear(null)
      startNext(source)
    }
    if (exit.error._tag === 'Die') source.broke(exit.error.defect)
  }

  const sayWhileNotLoaded = (step: 'slow' | 'long'): void =>
    load.update((now) => (now.loaded ? now : { ...now, step }))

  const stop = (): void => {
    cancelRepair()
    const stopped = run
    run = null
    stopped?.interrupt()
    stopped?.waiting?.resolve(false)
  }

  const endWaiting = (): void => {
    next?.resolve(false)
    next = null
  }

  const wasJustAsked = (source: Source<A>): boolean => {
    const { loaded, step } = load.get()
    if (!loaded || step === 'failed' || !source.hearsChanges) return false
    return source.clock.now() - newestAnswerAskedAt < JUST_ASKED_MS
  }

  return {
    get: value.get,
    subscribe: value.subscribe,
    set: (replacement) => change(() => replacement),
    update: change,
    load,
    open: (source) =>
      T.suspend(() => {
        if (run === null) return wasJustAsked(source) ? T.succeed(true) : askNext(source).wait
        if (run.isResting) return T.succeed(false)
        return (run.waiting ?? afterRunning()).wait
      }),
    invalidate: (source) => T.sync(() => void askNext(source)),
    refresh: (source) => T.suspend(() => askNext(source).wait),
    again: (source) =>
      T.sync(() => {
        stop()
        askNext(source)
      }),
    reset: () => {
      stop()
      endWaiting()
      newestAnswerAskedAt = Number.NEGATIVE_INFINITY
      batch(() => {
        value.set(empty)
        load.set(NOT_ASKED)
      })
    },
  }
}

export interface Resource<A> extends Signal<A> {
  /** A change that is already true on the server. It may be made twice, so twice must mean the same as once. */
  readonly update: Signal<A>['update']
  readonly load: ReadableSignal<Load>
  /** A page shows it: asks, unless a request runs or one just did. Ends as that request does, true when answered. */
  readonly open: (source: Source<A>) => T.Task<boolean>
  /** It changed: asks, after the running request when there is one. */
  readonly invalidate: (source: Source<A>) => T.Task<void>
  /** Ends with a request that started after this call, never with one already running; true when answered. */
  readonly refresh: (source: Source<A>) => T.Task<boolean>
  /** Try again: ends the running request and asks afresh. */
  readonly again: (source: Source<A>) => T.Task<void>
  /** The session ended: ends whatever runs or waits, and leaves it as it was before it was first asked for. */
  readonly reset: () => void
}

/** How a resource is asked for, and who hears how that went. */
export interface Source<A> {
  readonly ask: T.Task<A, ApiError>
  readonly clock: Clock
  /** Aborted when the session ends; nothing is asked or applied after that. */
  readonly ended: AbortSignal
  /** Whether the page hears of changes, so that an answer just asked for still counts. */
  readonly hearsChanges: boolean
  readonly answered: (askedAt: number) => void
  readonly failed: (error: ApiError) => void
  readonly broke: (defect: unknown) => void
}

export interface Load {
  /** Whether the value came from the server; an empty one that did not never means "none". */
  readonly loaded: boolean
  readonly step: 'idle' | 'loading' | 'slow' | 'long' | 'failed'
  readonly error: ApiError | null
}

interface Run<A> {
  /** The changes made since the attempt on its way asked, which its answer may lack. */
  changes: Array<(current: A) => A>
  /** Who waits for the attempt on its way. */
  waiting: Deferred<boolean> | null
  /** Between two attempts, when nothing is on its way. */
  isResting: boolean
  interrupt: () => void
}

/** A quiet run repairs a failure that was told already, or that nobody had to be told of. */
type Telling = 'told' | 'quiet'

const NOT_ASKED: Load = { loaded: false, step: 'idle', error: null }

/** Places that open together, as the bell, the workspace and a page do at start, share one request. */
const JUST_ASKED_MS = 2000

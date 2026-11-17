/**
 * Task: a lazy, cancellable, typed asynchronous computation.
 *
 *   Task<A, E, R>  ~  (env: R, signal: AbortSignal) => Promise<Result<A, Cause<E>>>
 *
 * - Lazy: building a Task runs nothing.
 * - Typed errors: expected failures are values in `E`, never thrown.
 * - Typed requirements: `R` is the environment the task reads services from.
 * - Cancellable: every task observes an AbortSignal; interruption is a first-class outcome.
 * - Structured: `all`, `race` and `scoped` never leak a running child past their own completion.
 *
 * Tasks are iterable, so `yield*` sequences them inside `Task.gen`.
 */
import type { Clock as ClockService, HasClock } from './clock.ts'
import { type ByTag, type Tagged, tagged } from './data.ts'
import type { UnionToIntersection } from './fn.ts'
import { type Result, err, isOk, ok } from './result.ts'

// ---------------------------------------------------------------------------------------------
// Cause and Exit
// ---------------------------------------------------------------------------------------------

/** An expected, typed failure. */
export interface Fail<out E> extends Tagged<'Fail'> {
  readonly error: E
}
/** The task was cancelled before it finished. */
export interface Interrupt extends Tagged<'Interrupt'> {}
/** A defect: something threw. Always a bug or an unrecoverable condition. */
export interface Die extends Tagged<'Die'> {
  readonly defect: unknown
}
export type Cause<E> = Fail<E> | Interrupt | Die
export type Exit<A, E> = Result<A, Cause<E>>

export const failCause = <E>(error: E): Cause<E> => ({ _tag: 'Fail', error })
export const interruptCause: Cause<never> = { _tag: 'Interrupt' }
export const dieCause = (defect: unknown): Cause<never> => ({ _tag: 'Die', defect })

const INTERRUPTED: Exit<never, never> = err(interruptCause)

/** A signal that never aborts: the uninterruptible region. */
export const NEVER_ABORTED: AbortSignal = new AbortController().signal

/** Thrown by `runPromise` when a task does not succeed. */
export class TaskError<E> extends Error {
  override readonly cause: Cause<E>
  constructor(cause: Cause<E>) {
    super(
      cause._tag === 'Fail'
        ? `Task failed: ${safeJson(cause.error)}`
        : cause._tag === 'Die'
          ? `Task died: ${cause.defect instanceof Error ? cause.defect.message : safeJson(cause.defect)}`
          : 'Task interrupted',
    )
    this.name = 'TaskError'
    this.cause = cause
  }
}

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// ---------------------------------------------------------------------------------------------
// The Task type
// ---------------------------------------------------------------------------------------------

export interface Task<out A, out E = never, in R = unknown> {
  /** Never rejects. Resolves promptly with Interrupt once `signal` aborts. */
  readonly run: (env: R, signal: AbortSignal) => Promise<Exit<A, E>>
  [Symbol.iterator](): Generator<Task<A, E, R>, A, any>
  pipe<B>(f: (self: Task<A, E, R>) => B): B
  pipe<B, C>(f: (self: Task<A, E, R>) => B, g: (b: B) => C): C
  pipe<B, C, D>(f: (self: Task<A, E, R>) => B, g: (b: B) => C, h: (c: C) => D): D
  pipe<B, C, D, F>(f: (self: Task<A, E, R>) => B, g: (b: B) => C, h: (c: C) => D, i: (d: D) => F): F
}

export type ValueOf<T> = T extends Task<infer A, any, any> ? A : never
export type ErrorOf<T> = T extends Task<any, infer E, any> ? E : never
export type EnvOf<T> = UnionToIntersection<T extends Task<any, any, infer R> ? R : never>

class TaskImpl<A, E, R> {
  readonly run: (env: R, signal: AbortSignal) => Promise<Exit<A, E>>
  constructor(run: (env: R, signal: AbortSignal) => Promise<Exit<A, E>>) {
    this.run = run
  }
  *[Symbol.iterator](): Generator<Task<A, E, R>, A, any> {
    return (yield this as unknown as Task<A, E, R>) as A
  }
  pipe(...fns: ReadonlyArray<(x: any) => any>): unknown {
    let acc: unknown = this
    for (const f of fns) acc = f(acc)
    return acc
  }
}

/**
 * The one primitive constructor. Wraps `run` so that it observes cancellation before starting
 * and turns anything thrown into a defect.
 */
export const make = <A, E = never, R = unknown>(
  run: (env: R, signal: AbortSignal) => Promise<Exit<A, E>> | Exit<A, E>,
): Task<A, E, R> =>
  new TaskImpl<A, E, R>(async (env, signal) => {
    if (signal.aborted) return INTERRUPTED
    try {
      return await run(env, signal)
    } catch (defect) {
      return err(dieCause(defect))
    }
  }) as unknown as Task<A, E, R>

export const isTask = (u: unknown): u is Task<unknown, unknown, unknown> => u instanceof TaskImpl

// ---------------------------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------------------------

export const succeed = <A>(value: A): Task<A> => make(() => ok(value))
export const fail = <E>(error: E): Task<never, E> => make(() => err(failCause(error)))
export const die = (defect: unknown): Task<never> => make(() => err(dieCause(defect)))
export const interrupt: Task<never> = make(() => INTERRUPTED)
export const unit: Task<void> = succeed(undefined)
export const fromExit = <A, E>(exit: Exit<A, E>): Task<A, E> => make(() => exit)
export const fromResult = <A, E>(result: Result<A, E>): Task<A, E> =>
  make(() => (isOk(result) ? result : err(failCause(result.error))))

/** A synchronous effect. A throw is a defect. */
export const sync = <A>(f: () => A): Task<A> => make(() => ok(f()))

/** A synchronous effect that may throw an expected error. */
export const attempt = <A, E>(f: () => A, onThrow: (cause: unknown) => E): Task<A, E> =>
  make(() => {
    try {
      return ok(f())
    } catch (cause) {
      return err(failCause(onThrow(cause)))
    }
  })

/** Defers building a task until it runs. */
export const suspend = <A, E, R>(f: () => Task<A, E, R>): Task<A, E, R> => make((env, signal) => f().run(env, signal))

/**
 * Resolves with Interrupt as soon as the signal aborts, even if the promise ignores it.
 * The abandoned promise's eventual rejection is swallowed.
 */
const abortable = <A, E>(promise: Promise<Exit<A, E>>, signal: AbortSignal): Promise<Exit<A, E>> =>
  new Promise((resolve) => {
    const onAbort = () => resolve(INTERRUPTED)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (exit) => {
        signal.removeEventListener('abort', onAbort)
        resolve(signal.aborted ? INTERRUPTED : exit)
      },
      (defect) => {
        signal.removeEventListener('abort', onAbort)
        resolve(signal.aborted ? INTERRUPTED : err(dieCause(defect)))
      },
    )
  })

/** An async effect. A rejection is a defect. The signal is passed through for cooperative abort. */
export const promise = <A>(f: (signal: AbortSignal) => Promise<A>): Task<A> =>
  make((_, signal) => abortable(Promise.resolve().then(() => f(signal).then(ok)), signal))

/** An async effect whose rejection is an expected error. */
export const tryPromise = <A, E>(
  f: (signal: AbortSignal) => Promise<A>,
  onReject: (cause: unknown) => E,
): Task<A, E> =>
  make((_, signal) =>
    abortable(
      Promise.resolve().then(() =>
        f(signal).then(
          (a) => ok(a) as Exit<A, E>,
          (cause) => err(failCause(onReject(cause))),
        ),
      ),
      signal,
    ),
  )

/**
 * Callback interop. `register` receives `resume` and returns a canceller that runs if the task
 * is interrupted before `resume` is called.
 */
export const async = <A, E = never>(register: (resume: (exit: Exit<A, E>) => void) => () => void): Task<A, E> =>
  make(
    (_, signal) =>
      new Promise<Exit<A, E>>((resolve) => {
        let settled = false
        const onAbort = () => {
          if (settled) return
          settled = true
          cancel()
          resolve(INTERRUPTED)
        }
        const cancel = register((exit) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          resolve(exit)
        })
        if (!settled) signal.addEventListener('abort', onAbort, { once: true })
      }),
  )

/** Never completes; ends only by interruption. */
export const never: Task<never> = async(() => () => {})

// ---------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------

/** Reads the whole environment. */
export const ask = <R>(): Task<R, never, R> => make((env) => ok(env))

export interface ServiceTag<K extends string, S> extends Task<S, never, { readonly [P in K]: S }> {
  readonly key: K
  /** Builds the environment slice for this service. */
  readonly of: (service: S) => { readonly [P in K]: S }
}

/**
 * Declares a service slot in the environment.
 *
 *     const Clock = Task.service<Clock>()('clock')
 *     const now = Task.gen(function* () { return (yield* Clock).now() })
 */
export const service =
  <S>() =>
  <K extends string>(key: K): ServiceTag<K, S> =>
    Object.assign(
      make<S, never, { readonly [P in K]: S }>((env) => ok(env[key])),
      { key, of: (svc: S) => ({ [key]: svc }) as { readonly [P in K]: S } },
    )

/** Supplies part of the environment, removing it from the requirements. */
export const provide =
  <P extends object>(provided: P) =>
  <A, E, R>(task: Task<A, E, R>): Task<A, E, Omit<R, keyof P>> =>
    make((env, signal) => task.run({ ...(env as object), ...provided } as unknown as R, signal))

// ---------------------------------------------------------------------------------------------
// Sequencing
// ---------------------------------------------------------------------------------------------

export const map =
  <A, B>(f: (a: A) => B) =>
  <E, R>(task: Task<A, E, R>): Task<B, E, R> =>
    make(async (env, signal) => {
      const exit = await task.run(env, signal)
      return isOk(exit) ? ok(f(exit.value)) : exit
    })

export const as =
  <B>(value: B) =>
  <A, E, R>(task: Task<A, E, R>): Task<B, E, R> =>
    map(() => value)(task)

export const asUnit = <A, E, R>(task: Task<A, E, R>): Task<void, E, R> => map(() => undefined)(task)

export const flatMap =
  <A, B, E2, R2>(f: (a: A) => Task<B, E2, R2>) =>
  <E, R>(task: Task<A, E, R>): Task<B, E | E2, R & R2> =>
    make<B, E | E2, R & R2>(async (env, signal) => {
      const exit = await task.run(env, signal)
      return isOk(exit) ? f(exit.value).run(env, signal) : exit
    })

/** Runs an effect on success and keeps the original value. */
export const tap =
  <A, E2, R2>(f: (a: A) => Task<unknown, E2, R2>) =>
  <E, R>(task: Task<A, E, R>): Task<A, E | E2, R & R2> =>
    flatMap((a: A) => map(() => a)(f(a)))(task)

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A, R>(task: Task<A, E, R>): Task<A, E2, R> =>
    make(async (env, signal) => {
      const exit = await task.run(env, signal)
      return !isOk(exit) && exit.error._tag === 'Fail' ? err(failCause(f(exit.error.error))) : (exit as Exit<A, never>)
    })

/** Recovers from every expected failure. Interrupts and defects pass through. */
export const catchAll =
  <E, B, E2, R2>(f: (e: E) => Task<B, E2, R2>) =>
  <A, R>(task: Task<A, E, R>): Task<A | B, E2, R & R2> =>
    make<A | B, E2, R & R2>(async (env, signal) => {
      const exit = await task.run(env, signal)
      return !isOk(exit) && exit.error._tag === 'Fail' ? f(exit.error.error).run(env, signal) : (exit as Exit<A, never>)
    })

/** Recovers from the failures carrying one `_tag`, removing them from the error type. */
export const catchTag =
  <E, T extends E extends Tagged<infer K> ? K : never, B, E2, R2>(tag: T, f: (e: ByTag<E, T>) => Task<B, E2, R2>) =>
  <A, R>(task: Task<A, E, R>): Task<A | B, Exclude<E, { readonly _tag: T }> | E2, R & R2> =>
    make<A | B, Exclude<E, { readonly _tag: T }> | E2, R & R2>(async (env, signal) => {
      const exit = await task.run(env, signal)
      if (!isOk(exit) && exit.error._tag === 'Fail' && (exit.error.error as Tagged<string>)?._tag === tag)
        return f(exit.error.error as ByTag<E, T>).run(env, signal)
      return exit as Exit<A, Exclude<E, { readonly _tag: T }>>
    })

export const tapError =
  <E, E2, R2>(f: (e: E) => Task<unknown, E2, R2>) =>
  <A, R>(task: Task<A, E, R>): Task<A, E | E2, R & R2> =>
    catchAll((e: E) => flatMap(() => fail(e))(f(e)))(task)

/** Moves the expected failure into the value, leaving a task that cannot fail. */
export const result = <A, E, R>(task: Task<A, E, R>): Task<Result<A, E>, never, R> =>
  make<Result<A, E>, never, R>(async (env, signal) => {
    const exit = await task.run(env, signal)
    if (isOk(exit)) return ok(ok(exit.value))
    return exit.error._tag === 'Fail' ? ok(err(exit.error.error)) : (exit as Exit<never, never>)
  })

/** Moves the whole outcome, interruption included, into the value. */
export const exit = <A, E, R>(task: Task<A, E, R>): Task<Exit<A, E>, never, R> =>
  make(async (env, signal) => {
    const out = await task.run(env, signal)
    return signal.aborted ? INTERRUPTED : ok(out)
  })

/** Treats an expected failure as a defect. */
export const orDie = <A, E, R>(task: Task<A, E, R>): Task<A, never, R> =>
  make(async (env, signal) => {
    const out = await task.run(env, signal)
    return !isOk(out) && out.error._tag === 'Fail' ? err(dieCause(out.error.error)) : (out as Exit<A, never>)
  })

export const fold =
  <A, E, B, C>(onFail: (e: E) => B, onOk: (a: A) => C) =>
  <R>(task: Task<A, E, R>): Task<B | C, never, R> =>
    map((r: Result<A, E>) => (isOk(r) ? onOk(r.value) : onFail(r.error)))(result(task))

/**
 * Do-notation. `yield*` a Task to await its value. The first failure ends the block, and so does
 * interruption; either way `finally` blocks in the generator run, and may `yield*` cleanup tasks,
 * which run uninterruptibly.
 *
 *     const program = Task.gen(function* () {
 *       const clock = yield* Clock
 *       const user = yield* loadUser(id)
 *       return { user, at: clock.now() }
 *     })
 */
export const gen = <Y extends Task<any, any, any>, A>(
  f: () => Generator<Y, A, any>,
): Task<A, ErrorOf<Y>, EnvOf<Y>> =>
  make(async (env, signal) => {
    const it = f()
    /** Unwinds the generator, driving any tasks its `finally` blocks yield. */
    const unwind = async (): Promise<void> => {
      let step = it.return(undefined as never)
      while (!step.done) {
        const exit = await (step.value as Task<unknown, unknown, unknown>).run(env, NEVER_ABORTED)
        step = isOk(exit) ? it.next(exit.value) : it.return(undefined as never)
      }
    }
    let step = it.next()
    while (!step.done) {
      const exit = await (step.value as Task<unknown, unknown, unknown>).run(env, signal)
      if (!isOk(exit)) {
        await unwind()
        return exit as Exit<never, ErrorOf<Y>>
      }
      step = it.next(exit.value)
    }
    return ok(step.value)
  })

// ---------------------------------------------------------------------------------------------
// Resources and interruption
// ---------------------------------------------------------------------------------------------

/** Shields a task from interruption: it runs to completion once started. */
export const uninterruptible = <A, E, R>(task: Task<A, E, R>): Task<A, E, R> =>
  make((env) => task.run(env, NEVER_ABORTED))

/** Runs `finalizer` after the task, whatever its outcome. The finalizer is uninterruptible. */
export const ensuring =
  <R2>(finalizer: Task<unknown, never, R2>) =>
  <A, E, R>(task: Task<A, E, R>): Task<A, E, R & R2> =>
    new TaskImpl<A, E, R & R2>(async (env, signal) => {
      const out = await task.run(env, signal)
      const cleanup = await finalizer.run(env, NEVER_ABORTED)
      return isOk(cleanup) ? out : (cleanup as Exit<never, never>)
    }) as unknown as Task<A, E, R & R2>

/** Acquire, use, release. Acquisition and release are uninterruptible; release always runs. */
export const bracket = <A, E, R, B, E2, R2, R3>(
  acquire: Task<A, E, R>,
  use: (resource: A) => Task<B, E2, R2>,
  release: (resource: A, exit: Exit<B, E2>) => Task<unknown, never, R3>,
): Task<B, E | E2, R & R2 & R3> =>
  new TaskImpl<B, E | E2, R & R2 & R3>(async (env, signal) => {
    if (signal.aborted) return INTERRUPTED
    const acquired = await acquire.run(env, NEVER_ABORTED)
    if (!isOk(acquired)) return acquired
    const out = await use(acquired.value).run(env, signal)
    const released = await release(acquired.value, out).run(env, NEVER_ABORTED)
    return isOk(released) ? out : (released as Exit<never, never>)
  }) as unknown as Task<B, E | E2, R & R2 & R3>

/** A child controller that aborts when the parent does. `dispose` detaches it. */
const linked = (parent: AbortSignal): { controller: AbortController; dispose: () => void } => {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (parent.aborted) controller.abort()
  else parent.addEventListener('abort', onAbort, { once: true })
  return { controller, dispose: () => parent.removeEventListener('abort', onAbort) }
}

// ---------------------------------------------------------------------------------------------
// Structured concurrency
// ---------------------------------------------------------------------------------------------

/** Picks the most informative cause: a defect, then a failure, then interruption. */
const worst = <E>(causes: ReadonlyArray<Cause<E>>): Cause<E> =>
  causes.find((c) => c._tag === 'Die') ?? causes.find((c) => c._tag === 'Fail') ?? interruptCause

export interface ConcurrencyOptions {
  /** Maximum number of tasks in flight. Defaults to unbounded. */
  readonly concurrency?: number
}

type AllValues<T> = { -readonly [K in keyof T]: ValueOf<T[K]> }

/**
 * Runs tasks concurrently and collects every value, in input order. The first failure interrupts
 * the rest, and `all` completes only after every child has stopped.
 */
export const all = <const T extends ReadonlyArray<Task<any, any, any>>>(
  tasks: T,
  options: ConcurrencyOptions = {},
): Task<AllValues<T>, ErrorOf<T[number]>, EnvOf<T[number]>> =>
  make(async (env, signal) => {
    const { controller, dispose } = linked(signal)
    const values = new Array<unknown>(tasks.length)
    const causes: Cause<ErrorOf<T[number]>>[] = []
    const queue = tasks.entries()
    const worker = async (): Promise<void> => {
      for (const [index, task] of queue) {
        const out = await task.run(env, controller.signal)
        if (isOk(out)) values[index] = out.value
        else {
          causes.push(out.error)
          controller.abort()
          return
        }
      }
    }
    const width = Math.max(1, Math.min(options.concurrency ?? tasks.length, tasks.length))
    await Promise.all(Array.from({ length: width }, worker))
    dispose()
    if (signal.aborted) return INTERRUPTED
    return causes.length > 0 ? err(worst(causes)) : ok(values as AllValues<T>)
  })

/** `all` over a record of tasks, keeping the keys. */
export const struct = <const T extends Readonly<Record<string, Task<any, any, any>>>>(
  tasks: T,
  options: ConcurrencyOptions = {},
): Task<{ -readonly [K in keyof T]: ValueOf<T[K]> }, ErrorOf<T[keyof T]>, EnvOf<T[keyof T]>> => {
  const keys = Object.keys(tasks)
  return map((values: ReadonlyArray<unknown>) => Object.fromEntries(keys.map((k, i) => [k, values[i]])) as never)(
    all(
      keys.map((k) => tasks[k]!),
      options,
    ),
  ) as never
}

/** Maps every item to a task and runs them like `all`. */
export const forEach = <X, A, E, R>(
  items: Iterable<X>,
  f: (item: X, index: number) => Task<A, E, R>,
  options: ConcurrencyOptions = { concurrency: 1 },
): Task<A[], E, R> => suspend(() => all(Array.from(items, f), options) as unknown as Task<A[], E, R>)

/**
 * Runs tasks concurrently; the first to settle decides the outcome. The losers are interrupted,
 * and `race` completes only after they have stopped.
 */
export const race = <const T extends ReadonlyArray<Task<any, any, any>>>(
  tasks: T,
): Task<ValueOf<T[number]>, ErrorOf<T[number]>, EnvOf<T[number]>> =>
  make(async (env, signal) => {
    if (tasks.length === 0) return never.run(env, signal)
    const { controller, dispose } = linked(signal)
    let winner: Exit<ValueOf<T[number]>, ErrorOf<T[number]>> | undefined
    await Promise.all(
      tasks.map(async (task) => {
        const out = await task.run(env, controller.signal)
        if (winner === undefined) {
          winner = out
          controller.abort()
        }
      }),
    )
    dispose()
    return signal.aborted ? INTERRUPTED : winner!
  })

export interface Fiber<A, E> {
  /** Settles when the fiber stops. Never rejects. */
  readonly exit: Promise<Exit<A, E>>
  /** Waits for the fiber and adopts its outcome. */
  readonly join: Task<A, E>
  /** Interrupts the fiber and waits until it has stopped. */
  readonly interrupt: Task<void>
}

export interface Scope {
  /** Starts a task in the background. It is interrupted when the scope closes. */
  readonly fork: <A, E, R>(task: Task<A, E, R>) => Task<Fiber<A, E>, never, R>
  /** Registers cleanup to run when the scope closes, in reverse order of registration. */
  readonly addFinalizer: (finalizer: Task<unknown, never, unknown>) => Task<void>
}

/**
 * Opens a scope for the duration of `body`. When the body ends, every fiber forked in the scope is
 * interrupted and awaited, then finalizers run. Nothing started inside outlives the scope.
 */
export const scoped = <A, E, R>(body: (scope: Scope) => Task<A, E, R>): Task<A, E, R> =>
  new TaskImpl<A, E, R>(async (env, signal) => {
    if (signal.aborted) return INTERRUPTED
    const { controller, dispose } = linked(signal)
    const fibers = new Set<Promise<unknown>>()
    const finalizers: Task<unknown, never, unknown>[] = []
    const scope: Scope = {
      fork: (task) =>
        make((forkEnv) => {
          const own = linked(controller.signal)
          const running = task.run(forkEnv, own.controller.signal).finally(() => {
            own.dispose()
            fibers.delete(running)
          })
          fibers.add(running)
          return ok({
            exit: running,
            join: make((_, joinSignal) => abortable(running, joinSignal)),
            interrupt: make(async () => {
              own.controller.abort()
              await running
              return ok(undefined)
            }),
          })
        }),
      addFinalizer: (finalizer) =>
        sync(() => {
          finalizers.push(finalizer)
        }),
    }
    let out: Exit<A, E>
    try {
      out = await body(scope).run(env, signal)
    } catch (defect) {
      out = err(dieCause(defect))
    }
    controller.abort()
    dispose()
    await Promise.all(fibers)
    for (const finalizer of finalizers.reverse()) {
      const cleanup = await finalizer.run(env, NEVER_ABORTED)
      if (!isOk(cleanup) && isOk(out)) out = cleanup as Exit<never, never>
    }
    return out
  }) as unknown as Task<A, E, R>

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

export const Clock: ServiceTag<'clock', ClockService> = service<ClockService>()('clock')

export const now: Task<number, never, HasClock> = map((clock: ClockService) => clock.now())(Clock)

export const sleep = (ms: number): Task<void, never, HasClock> =>
  make(async (env, signal) => {
    await env.clock.sleep(ms, signal)
    return signal.aborted ? INTERRUPTED : ok(undefined)
  })

export const TimeoutError = tagged('TimeoutError')<{ readonly ms: number }>()
export type TimeoutError = ReturnType<typeof TimeoutError>

/** Fails with TimeoutError, interrupting the task, if it has not settled within `ms`. */
export const timeout =
  (ms: number) =>
  <A, E, R>(task: Task<A, E, R>): Task<A, E | TimeoutError, R & HasClock> =>
    race([task, flatMap(() => fail(TimeoutError({ ms })))(sleep(ms))]) as Task<A, E | TimeoutError, R & HasClock>

export interface RetryOptions<E> {
  /** Delays between attempts, in milliseconds. Retrying stops when the iterable is exhausted. */
  readonly schedule: () => Iterable<number>
  /** Retry only failures that satisfy this predicate. Defaults to all. */
  readonly while?: (error: E) => boolean
}

/** Re-runs a failing task, sleeping between attempts as the schedule dictates. */
export const retry =
  <E>(options: RetryOptions<E>) =>
  <A, R>(task: Task<A, E, R>): Task<A, E, R & HasClock> =>
    make(async (env, signal) => {
      const delays = options.schedule()[Symbol.iterator]()
      try {
        for (;;) {
          const out = await task.run(env, signal)
          if (isOk(out) || out.error._tag !== 'Fail') return out
          if (options.while && !options.while(out.error.error)) return out
          const delay = delays.next()
          if (delay.done) return out
          await env.clock.sleep(delay.value, signal)
          if (signal.aborted) return INTERRUPTED
        }
      } finally {
        delays.return?.()
      }
    })

/** Repeats a task forever, sleeping `ms` between runs. Ends on failure or interruption. */
export const forever =
  (ms: number) =>
  <E, R>(task: Task<unknown, E, R>): Task<never, E, R & HasClock> =>
    make(async (env, signal) => {
      for (;;) {
        const out = await task.run(env, signal)
        if (!isOk(out)) return out
        await env.clock.sleep(ms, signal)
        if (signal.aborted) return INTERRUPTED
      }
    })

// ---------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------

type RunArgs<R> = unknown extends R ? [env?: R, signal?: AbortSignal] : [env: R, signal?: AbortSignal]

/** Runs a task to its Exit. Never rejects. */
export const run = <A, E, R>(task: Task<A, E, R>, ...[env, signal]: RunArgs<R>): Promise<Exit<A, E>> =>
  task.run(env as R, signal ?? NEVER_ABORTED)

/** Runs a task, resolving with its value or rejecting with a TaskError. */
export const runPromise = async <A, E, R>(task: Task<A, E, R>, ...args: RunArgs<R>): Promise<A> => {
  const out = await run(task, ...args)
  if (isOk(out)) return out.value
  throw new TaskError(out.error)
}

export interface RunningTask<A, E> {
  readonly exit: Promise<Exit<A, E>>
  /** Interrupts the task and resolves once it has stopped. */
  readonly interrupt: () => Promise<Exit<A, E>>
}

/** Starts a task at the edge of the program and hands back a handle to stop it. */
export const runFork = <A, E, R>(task: Task<A, E, R>, ...[env, signal]: RunArgs<R>): RunningTask<A, E> => {
  const { controller, dispose } = linked(signal ?? NEVER_ABORTED)
  const running = task.run(env as R, controller.signal).finally(dispose)
  return {
    exit: running,
    interrupt: () => {
      controller.abort()
      return running
    },
  }
}

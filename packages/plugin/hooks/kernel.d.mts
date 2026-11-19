// The part of the kernel's Task and Stream the plugin uses; kernel/test/plugin-kernel.test.ts checks
// that the bundle exports each value declared here.

export declare namespace T {
  type Cause<E> =
    | { readonly _tag: 'Fail'; readonly error: E }
    | { readonly _tag: 'Interrupt' }
    | { readonly _tag: 'Die'; readonly defect: unknown }
  type Exit<A, E> =
    | { readonly _tag: 'Ok'; readonly value: A }
    | { readonly _tag: 'Err'; readonly error: Cause<E> }
  interface Task<out A, out E = never, in R = unknown> {
    readonly run: (env: R, signal: AbortSignal) => Promise<Exit<A, E>>
    [Symbol.iterator](): Generator<Task<A, E, R>, A, any>
  }
  interface RunningTask<A, E> {
    readonly exit: Promise<Exit<A, E>>
  }
  const unit: Task<void>
  const succeed: <A>(value: A) => Task<A>
  const sync: <A>(f: () => A) => Task<A>
  const suspend: <A, E, R>(f: () => Task<A, E, R>) => Task<A, E, R>
  const promise: <A>(f: (signal: AbortSignal) => Promise<A>) => Task<A>
  const fromExit: <A, E>(exit: Exit<A, E>) => Task<A, E>
  const exit: <A, E, R>(task: Task<A, E, R>) => Task<Exit<A, E>, never, R>
  const as: <B>(value: B) => <A, E, R>(task: Task<A, E, R>) => Task<B, E, R>
  const map: <A, B>(f: (a: A) => B) => <E, R>(task: Task<A, E, R>) => Task<B, E, R>
  const flatMap: <A, B, E2, R2>(
    f: (a: A) => Task<B, E2, R2>,
  ) => <E, R>(task: Task<A, E, R>) => Task<B, E | E2, R & R2>
  const gen: <Y extends Task<any, any, any>, A>(
    body: () => Generator<Y, A, any>,
  ) => Task<A, Y extends Task<any, infer E, any> ? E : never, unknown>
  const runPromise: <A, E>(task: Task<A, E, unknown>) => Promise<A>
  const runFork: <A, E>(task: Task<A, E, unknown>) => RunningTask<A, E>
}

export declare namespace Stream {
  type Stream<A> = AsyncIterable<A>
  const of: <A>(...items: A[]) => Stream<A>
  const forEach: <A, E, R>(f: (a: A) => T.Task<unknown, E, R>) => (source: Stream<A>) => T.Task<void, E, R>
  const flatMap: <A, B>(f: (a: A) => Stream<B> | Iterable<B>) => (source: Stream<A>) => Stream<B>
  const takeWhile: <A>(f: (a: A) => boolean) => (source: Stream<A>) => Stream<A>
}

export interface Deferred<A> {
  readonly wait: T.Task<A>
  readonly resolve: (value: A) => boolean
  readonly isDone: () => boolean
}

export declare const makeDeferred: <A>() => Deferred<A>

import { T } from './kernel.mjs'

/** One call to the host, whose answer may be a promise or a plain value; a rejection is a defect. */
export const host = <A>(call: () => A | PromiseLike<A>): T.Task<Awaited<A>> =>
  T.promise(() => Promise.resolve().then(call) as Promise<Awaited<A>>)

/** One call to the host, read as the fallback when the host refuses it or throws. */
export const hostOr = <A, B>(call: () => A | PromiseLike<A>, fallback: B): T.Task<Awaited<A> | B> =>
  rescued(host(call), () => fallback)

/** A task whose failure or defect becomes a value, as a try and catch around it would. */
export const rescued = <A, B>(task: T.Task<A, unknown>, onFailure: (cause: unknown) => B): T.Task<A | B> =>
  T.map((exit: T.Exit<A, unknown>) => (exit._tag === 'Ok' ? exit.value : onFailure(causeOf(exit.error))))(
    T.exit(task),
  )

/** Starts work the session keeps doing on its own, such as following the stream; its end is not awaited. */
export const inBackground = (task: T.Task<unknown, unknown>): void => {
  T.runFork(task)
}

/** The task as a background step of another task. */
export const forked = (task: T.Task<unknown, unknown>): T.Task<void> => T.sync(() => inBackground(task))

/** The host awaits a promise at each hook and handler: the one place a plugin task is run. */
export const answered = <A>(task: T.Task<A, unknown>): Promise<A> => T.runPromise(task)

export const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const causeOf = (cause: T.Cause<unknown>): unknown =>
  cause._tag === 'Die' ? cause.defect : cause._tag === 'Fail' ? cause.error : new Error('interrupted')

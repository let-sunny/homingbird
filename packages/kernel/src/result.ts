import type { Tagged } from './data.ts'

export interface Ok<out A> extends Tagged<'Ok'> {
  readonly value: A
  [Symbol.iterator](): Generator<never, A>
}
export interface Err<out E> extends Tagged<'Err'> {
  readonly error: E
  [Symbol.iterator](): Generator<Err<E>, never>
}
export type Result<A, E = never> = Ok<A> | Err<E>

export type ValueOf<R> = R extends Ok<infer A> ? A : never
export type ErrorOf<R> = R extends Err<infer E> ? E : never

export const ok = <A>(value: A): Ok<A> => unwrappable({ _tag: 'Ok', value }) as Ok<A>
export const err = <E>(error: E): Err<E> => unwrappable({ _tag: 'Err', error }) as Err<E>

export const isOk = <A, E>(r: Result<A, E>): r is Ok<A> => r._tag === 'Ok'
export const isErr = <A, E>(r: Result<A, E>): r is Err<E> => r._tag === 'Err'
export const isResult = (u: unknown): u is Result<unknown, unknown> =>
  typeof u === 'object' &&
  u !== null &&
  (u as Partial<Iterable<unknown>>)[Symbol.iterator] === yieldSelfUnlessOk

export const map =
  <A, B>(f: (a: A) => B) =>
  <E>(r: Result<A, E>): Result<B, E> =>
    r._tag === 'Ok' ? ok(f(r.value)) : r

export const mapError =
  <E, F>(f: (e: E) => F) =>
  <A>(r: Result<A, E>): Result<A, F> =>
    r._tag === 'Err' ? err(f(r.error)) : r

export const flatMap =
  <A, B, F>(f: (a: A) => Result<B, F>) =>
  <E>(r: Result<A, E>): Result<B, E | F> =>
    r._tag === 'Ok' ? f(r.value) : r

export const orElse =
  <E, B, F>(f: (e: E) => Result<B, F>) =>
  <A>(r: Result<A, E>): Result<A | B, F> =>
    r._tag === 'Err' ? f(r.error) : r

export const fold =
  <A, E, B, C>(onErr: (e: E) => B, onOk: (a: A) => C) =>
  (r: Result<A, E>): B | C =>
    r._tag === 'Ok' ? onOk(r.value) : onErr(r.error)

export const getOrElse =
  <E, B>(f: (e: E) => B) =>
  <A>(r: Result<A, E>): A | B =>
    r._tag === 'Ok' ? r.value : f(r.error)

export const unwrap = <A, E>(r: Result<A, E>): A => {
  if (r._tag === 'Ok') return r.value
  throw r.error instanceof Error ? r.error : new Error(`unwrap on Err: ${JSON.stringify(r.error)}`)
}

export const fromNullable =
  <E>(onNull: () => E) =>
  <A>(a: A): Result<NonNullable<A>, E> =>
    a === null || a === undefined ? err(onNull()) : ok(a as NonNullable<A>)

export const attempt = <A, E>(f: () => A, onThrow: (cause: unknown) => E): Result<A, E> => {
  try {
    return ok(f())
  } catch (cause) {
    return err(onThrow(cause))
  }
}

export const all = <A, E>(results: Iterable<Result<A, E>>): Result<A[], E> => {
  const out: A[] = []
  for (const r of results) {
    if (r._tag === 'Err') return r
    out.push(r.value)
  }
  return ok(out)
}

export const partition = <A, E>(results: Iterable<Result<A, E>>): { oks: A[]; errs: E[] } => {
  const oks: A[] = []
  const errs: E[] = []
  for (const r of results) r._tag === 'Ok' ? oks.push(r.value) : errs.push(r.error)
  return { oks, errs }
}

export const gen = <Y extends Err<unknown>, A>(f: () => Generator<Y, A, never>): Result<A, ErrorOf<Y>> => {
  const it = f()
  const step = it.next()
  if (step.done) return ok(step.value)
  it.return(undefined as never)
  return step.value as Err<ErrorOf<Y>>
}

function unwrappable<T extends object>(fields: T): T {
  return Object.defineProperty(fields, Symbol.iterator, { value: yieldSelfUnlessOk })
}

function* yieldSelfUnlessOk(this: Result<unknown, unknown>): Generator<unknown, unknown> {
  if (this._tag === 'Ok') return this.value
  return yield this
}

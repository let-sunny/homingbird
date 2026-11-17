/**
 * Option: a value that may be absent. Iterable, so `yield*` unwraps it inside `Option.gen`.
 */
import type { Tagged } from './data.ts'
import { type Result, err, ok } from './result.ts'

const proto = {
  *[Symbol.iterator](this: Option<unknown>): Generator<unknown, unknown> {
    if (this._tag === 'Some') return this.value
    return (yield this) as never
  },
}

export interface Some<out A> extends Tagged<'Some'> {
  readonly value: A
  [Symbol.iterator](): Generator<never, A>
}
export interface None extends Tagged<'None'> {
  [Symbol.iterator](): Generator<None, never>
}
export type Option<A> = Some<A> | None

export const some = <A>(value: A): Some<A> => Object.assign(Object.create(proto), { _tag: 'Some', value })
export const none: None = Object.assign(Object.create(proto), { _tag: 'None' })

export const isSome = <A>(o: Option<A>): o is Some<A> => o._tag === 'Some'
export const isNone = <A>(o: Option<A>): o is None => o._tag === 'None'

export const fromNullable = <A>(a: A): Option<NonNullable<A>> =>
  a === null || a === undefined ? none : some(a as NonNullable<A>)

export const map =
  <A, B>(f: (a: A) => B) =>
  (o: Option<A>): Option<B> =>
    o._tag === 'Some' ? some(f(o.value)) : none

export const flatMap =
  <A, B>(f: (a: A) => Option<B>) =>
  (o: Option<A>): Option<B> =>
    o._tag === 'Some' ? f(o.value) : none

export const filter =
  <A>(p: (a: A) => boolean) =>
  (o: Option<A>): Option<A> =>
    o._tag === 'Some' && p(o.value) ? o : none

export const getOrElse =
  <B>(f: () => B) =>
  <A>(o: Option<A>): A | B =>
    o._tag === 'Some' ? o.value : f()

export const toNullable = <A>(o: Option<A>): A | null => (o._tag === 'Some' ? o.value : null)

export const toResult =
  <E>(onNone: () => E) =>
  <A>(o: Option<A>): Result<A, E> =>
    o._tag === 'Some' ? ok(o.value) : err(onNone())

/** Do-notation: the first None ends the block. */
export const gen = <A>(f: () => Generator<None, A, never>): Option<A> => {
  const it = f()
  const step = it.next()
  if (step.done) return some(step.value)
  it.return(undefined as never)
  return none
}

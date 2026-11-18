export type Simplify<T> = { [K in keyof T]: T[K] } & {}

export type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void
  ? I
  : never

export type Brand<T, Tag extends string> = T & { readonly [brand]: Tag }

export const identity = <A>(a: A): A => a

export const constant =
  <A>(a: A) =>
  (): A =>
    a

export const noop = (): void => {}

export const absurd = (value: never): never => {
  throw new Error(`Unreachable: ${JSON.stringify(value)}`)
}

export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: Fn<A, B>): B
export function pipe<A, B, C>(a: A, ab: Fn<A, B>, bc: Fn<B, C>): C
export function pipe<A, B, C, D>(a: A, ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>): D
export function pipe<A, B, C, D, E>(a: A, ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>, de: Fn<D, E>): E
export function pipe<A, B, C, D, E, F>(
  a: A,
  ab: Fn<A, B>,
  bc: Fn<B, C>,
  cd: Fn<C, D>,
  de: Fn<D, E>,
  ef: Fn<E, F>,
): F
export function pipe<A, B, C, D, E, F, G>(
  a: A,
  ab: Fn<A, B>,
  bc: Fn<B, C>,
  cd: Fn<C, D>,
  de: Fn<D, E>,
  ef: Fn<E, F>,
  fg: Fn<F, G>,
): G
export function pipe<A, B, C, D, E, F, G, H>(
  a: A,
  ab: Fn<A, B>,
  bc: Fn<B, C>,
  cd: Fn<C, D>,
  de: Fn<D, E>,
  ef: Fn<E, F>,
  fg: Fn<F, G>,
  gh: Fn<G, H>,
): H
export function pipe(a: unknown, ...fns: ReadonlyArray<Fn<any, any>>): unknown {
  let acc = a
  for (const f of fns) acc = f(acc)
  return acc
}

export function flow<A, B>(ab: Fn<A, B>): Fn<A, B>
export function flow<A, B, C>(ab: Fn<A, B>, bc: Fn<B, C>): Fn<A, C>
export function flow<A, B, C, D>(ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>): Fn<A, D>
export function flow<A, B, C, D, E>(ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>, de: Fn<D, E>): Fn<A, E>
export function flow(...fns: ReadonlyArray<Fn<any, any>>): Fn<unknown, unknown> {
  return (a) => {
    let acc = a
    for (const f of fns) acc = f(acc)
    return acc
  }
}

declare const brand: unique symbol

type Fn<A, B> = (a: A) => B

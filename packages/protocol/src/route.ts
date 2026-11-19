import type { Schema as S, Simplify } from '@homingbird/kernel'
import type { Access } from './policy.ts'

export const API_PREFIX = '/api/v1'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface Route<
  M extends Method = Method,
  P extends string = string,
  Q extends S.Fields | undefined = S.Fields | undefined,
  B extends S.Schema<any> | undefined = S.Schema<any> | undefined,
  R extends S.Schema<any> = S.Schema<any>,
  A extends Access = Access,
> {
  readonly method: M
  readonly path: P
  readonly access: A
  readonly query: Q
  readonly body: B
  readonly response: R
}

export const route = <
  const M extends Method,
  const P extends string,
  const A extends Access,
  R extends S.Schema<any>,
  Q extends S.Fields | undefined = undefined,
  B extends S.Schema<any> | undefined = undefined,
>(def: {
  method: M
  path: P
  access: A
  response: R
  query?: Q
  body?: B
}): Route<M, P, Q, B, R, A> => ({
  method: def.method,
  path: def.path,
  access: def.access,
  query: def.query as Q,
  body: def.body as B,
  response: def.response,
})

export type PathParams<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? { readonly [K in Param]: string } & PathParams<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? { readonly [K in Param]: string }
    : {}

export type RequestOf<R extends Route> = Simplify<
  (keyof PathParams<R['path']> extends never ? {} : { readonly params: Simplify<PathParams<R['path']>> }) &
    (R['query'] extends S.Fields ? { readonly query: S.InferFields<R['query']> } : {}) &
    (R['body'] extends S.Schema<infer B, any> ? { readonly body: B } : {})
>

/** What a server sends. */
export type ResponseOf<R extends Route> = S.Infer<R['response']>

/** What a client reads, every unknown enum value of a newer server included. */
export type ReadResponseOf<R extends Route> = S.Read<R['response']>

export const fillPath = (path: string, params: Readonly<Record<string, string>>): string =>
  path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) throw new RangeError(`missing path parameter "${key}"`)
    return encodeURIComponent(value)
  })

export const matchPath = (template: string, path: string): Record<string, string> | null => {
  const want = template.split('/')
  const got = path.split('/')
  if (want.length !== got.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    const segment = want[i]!
    const value = got[i]!
    if (segment.startsWith(':')) {
      if (value === '') return null
      try {
        params[segment.slice(1)] = decodeURIComponent(value)
      } catch {
        return null
      }
    } else if (segment !== value) return null
  }
  return params
}

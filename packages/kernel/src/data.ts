import type { Simplify } from './fn.ts'

export interface Tagged<Tag extends string> {
  readonly _tag: Tag
}

export type ByTag<U, T extends string> = Extract<U, { readonly _tag: T }>

export type TagOf<U> = U extends { readonly _tag: infer T extends string } ? T : never

export interface TaggedConstructor<Tag extends string, Fields extends object> {
  (fields: keyof Fields extends never ? void : Fields): Simplify<Tagged<Tag> & Readonly<Fields>>
  readonly tag: Tag
  readonly is: (u: unknown) => u is Simplify<Tagged<Tag> & Readonly<Fields>>
}

export const tagged =
  <Tag extends string>(tag: Tag) =>
  <Fields extends object = {}>(): TaggedConstructor<Tag, Fields> => {
    const make = (fields: Fields | void) => Object.freeze({ ...(fields ?? {}), _tag: tag })
    return Object.assign(make, {
      tag,
      is: (u: unknown): u is never => isTagged(u) && u._tag === tag,
    }) as unknown as TaggedConstructor<Tag, Fields>
  }

export const isTagged = (u: unknown): u is Tagged<string> =>
  typeof u === 'object' && u !== null && typeof (u as { _tag?: unknown })._tag === 'string'

export type Matcher<U extends Tagged<string>, Out> = { readonly [T in TagOf<U>]: (value: ByTag<U, T>) => Out }

export const match =
  <U extends Tagged<string>, Out>(cases: Matcher<U, Out>) =>
  (value: U): Out =>
    (cases as unknown as Record<string, (v: U) => Out>)[value._tag]!(value)

export const matchValue =
  <K extends string, Out>(cases: { readonly [P in K]: () => Out }) =>
  (value: K): Out =>
    cases[value]()

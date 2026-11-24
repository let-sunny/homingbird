/**
 * The name under which the code holds something, or null for any other text: only an own key of what the
 * page was made of is one, so nothing typed, sent or received can become a name.
 */
export const codeNameIn = (made: object, name: PropertyKey): CodeName | null =>
  typeof name === 'string' && Object.hasOwn(made, name) ? (name as CodeName) : null

export const pathOf = (parent: CodeName | null, name: CodeName): CodeName =>
  parent === null ? name : (`${parent}.${name}` as CodeName)

/** Text the recording may hold. */
export type CodeName = string & { readonly [CODE_NAME]: true }

declare const CODE_NAME: unique symbol

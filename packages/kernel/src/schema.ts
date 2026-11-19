import type { Brand, Simplify } from './fn.ts'
import { type Result, err, isOk, ok } from './result.ts'

export type Literal = string | number | boolean | null

export type Ast =
  | {
      readonly type: 'string'
      readonly minLength?: number
      readonly maxLength?: number
      readonly pattern?: string
    }
  | { readonly type: 'number'; readonly integer: boolean; readonly min?: number; readonly max?: number }
  | { readonly type: 'boolean' }
  | { readonly type: 'unknown' }
  | { readonly type: 'literal'; readonly values: ReadonlyArray<Literal> }
  | { readonly type: 'array'; readonly items: Ast; readonly minItems?: number; readonly maxItems?: number }
  | { readonly type: 'record'; readonly values: Ast }
  | { readonly type: 'struct'; readonly fields: Readonly<Record<string, FieldAst>> }
  | { readonly type: 'union'; readonly members: ReadonlyArray<Ast> }
  | { readonly type: 'refined'; readonly inner: Ast; readonly name: string }
  | { readonly type: 'tolerant'; readonly inner: Ast; readonly fallback: unknown }

export interface FieldAst {
  readonly ast: Ast
  readonly optional: boolean
  readonly fallback?: { readonly value: unknown }
}

export interface Issue {
  readonly path: ReadonlyArray<string | number>
  readonly message: string
}

/**
 * `decode` is strict: what a server accepts. `read` is what a client does with a response from a newer
 * server: it accepts longer text, larger numbers and longer lists than it knows of, and a `tolerant`
 * schema answers its fallback for a value it does not know. `A` is the decoded type, `R` the read one.
 */
export interface Schema<out A, out R = A> {
  readonly ast: Ast
  readonly decode: (input: unknown) => Result<A, ReadonlyArray<Issue>>
  readonly read: (input: unknown) => Result<R, ReadonlyArray<Issue>>
  readonly is: (input: unknown) => input is A
  readonly at: (input: unknown, path: Path) => Result<A, ReadonlyArray<Issue>>
  readonly readAt: (input: unknown, path: Path) => Result<R, ReadonlyArray<Issue>>
  /** Every reading, for composite schemas to pass their mode down. */
  readonly walk: (input: unknown, path: Path, mode: Mode) => Result<unknown, ReadonlyArray<Issue>>
}

/**
 * `exact` is `read` without the `tolerant` and `openVariants` fallbacks: it still accepts longer text,
 * larger numbers and longer lists, and still fills a missing field's default. A union reads each member
 * exactly before it lets any member fall back, so a value a member knows is never read as unknown.
 */
export type Mode = 'decode' | 'read' | 'exact'

export interface Optional<out A, out R = A> {
  readonly optional: Schema<A, R>
}

/** A field a client reads as its fallback when it is missing; decoding leaves it optional. */
export interface Defaulted<out A, out R = A> extends Optional<A, R> {
  readonly fallback: A
}

export type Infer<S> = S extends Schema<infer A, any>
  ? A
  : S extends Optional<infer A, any>
    ? A | undefined
    : never

export type Read<S> = S extends Schema<any, infer R>
  ? R
  : S extends Defaulted<any, infer R>
    ? R
    : S extends Optional<any, infer R>
      ? R | undefined
      : never

export interface StringOptions {
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: RegExp
}

export const string = (options: StringOptions = {}): Schema<string> => {
  const { minLength, maxLength, pattern } = options
  return make(
    {
      type: 'string',
      ...(minLength !== undefined && { minLength }),
      ...(maxLength !== undefined && { maxLength }),
      ...(pattern !== undefined && { pattern: pattern.source }),
    },
    (input, path, mode) => {
      if (typeof input !== 'string') return issue(path, `expected string, got ${describe(input)}`)
      if (minLength !== undefined && input.length < minLength)
        return issue(path, `expected at least ${minLength} characters`)
      if (mode === 'decode' && maxLength !== undefined && input.length > maxLength)
        return issue(path, `expected at most ${maxLength} characters`)
      if (pattern !== undefined && !pattern.test(input))
        return issue(path, `expected to match ${pattern.source}`)
      return ok(input)
    },
  )
}

export interface NumberOptions {
  readonly min?: number
  readonly max?: number
}

export const number = numeric(false)

export const int = numeric(true)

export const boolean: Schema<boolean> = make({ type: 'boolean' }, (input, path) =>
  typeof input === 'boolean' ? ok(input) : issue(path, `expected boolean, got ${describe(input)}`),
)

export const unknown: Schema<unknown> = make({ type: 'unknown' }, (input) => ok(input))

export const literal = <const L extends ReadonlyArray<Literal>>(...values: L): Schema<L[number]> =>
  make({ type: 'literal', values }, (input, path) =>
    values.includes(input as Literal)
      ? ok(input as L[number])
      : issue(path, `expected ${values.map((v) => JSON.stringify(v)).join(' | ')}`),
  )

/** Decodes like `schema`; reads anything `schema` cannot read as `fallback`, such as a newer server's enum value. */
export const tolerant = <A, R, const F>(schema: Schema<A, R>, fallback: F): Schema<A, R | F> =>
  make({ type: 'tolerant', inner: schema.ast, fallback }, (input, path, mode) => {
    const decoded = visit(schema, input, path, mode)
    return mode === 'read' && !isOk(decoded) ? ok(fallback) : decoded
  })

export interface ArrayOptions {
  readonly minItems?: number
  readonly maxItems?: number
}

export const array = <A, R = A>(
  items: Schema<A, R>,
  options: ArrayOptions = {},
): Schema<ReadonlyArray<A>, ReadonlyArray<R>> => {
  const { minItems, maxItems } = options
  return make(
    {
      type: 'array',
      items: items.ast,
      ...(minItems !== undefined && { minItems }),
      ...(maxItems !== undefined && { maxItems }),
    },
    (input, path, mode) => {
      if (!Array.isArray(input)) return issue(path, `expected array, got ${describe(input)}`)
      if (minItems !== undefined && input.length < minItems)
        return issue(path, `expected at least ${minItems} items`)
      if (mode === 'decode' && maxItems !== undefined && input.length > maxItems)
        return issue(path, `expected at most ${maxItems} items`)
      const out: unknown[] = []
      const issues: Issue[] = []
      input.forEach((item, index) => {
        const decoded = visit(items, item, [...path, index], mode)
        isOk(decoded) ? out.push(decoded.value) : issues.push(...decoded.error)
      })
      return issues.length > 0 ? err(issues) : ok(out)
    },
  )
}

export const record = <A, R = A>(
  values: Schema<A, R>,
): Schema<Readonly<Record<string, A>>, Readonly<Record<string, R>>> =>
  make({ type: 'record', values: values.ast }, (input, path, mode) => {
    if (!isPlainObject(input)) return issue(path, `expected object, got ${describe(input)}`)
    const out: Array<[string, unknown]> = []
    const issues: Issue[] = []
    for (const [key, value] of Object.entries(input)) {
      const decoded = visit(values, value, [...path, key], mode)
      isOk(decoded) ? out.push([key, decoded.value]) : issues.push(...decoded.error)
    }
    return issues.length > 0 ? err(issues) : ok(Object.fromEntries(out))
  })

export const optional = <A, R = A>(schema: Schema<A, R>): Optional<A, R> => ({ optional: schema })

export const withDefault = <A, R = A>(schema: Schema<A, R>, fallback: NoInfer<A>): Defaulted<A, R> => ({
  optional: schema,
  fallback,
})

export type Fields = Readonly<Record<string, Schema<any, any> | Optional<any, any>>>

export type InferFields<F> = Simplify<
  { readonly [K in Exclude<keyof F, OptionalKeys<F>>]: Infer<F[K]> } & {
    readonly [K in OptionalKeys<F>]?: F[K] extends Optional<infer A, any> ? A : never
  }
>

export type ReadFields<F> = Simplify<
  { readonly [K in Exclude<keyof F, ReadOptionalKeys<F>>]: Read<F[K]> } & {
    readonly [K in ReadOptionalKeys<F>]?: F[K] extends Optional<any, infer R> ? R : never
  }
>

export interface StructSchema<F extends Fields> extends Schema<InferFields<F>, ReadFields<F>> {
  readonly fields: F
}

export const struct = <F extends Fields>(fields: F): StructSchema<F> => {
  const entries = Object.entries(fields).map(([key, field]) => ({
    key,
    schema: isOptional(field) ? field.optional : field,
    optional: isOptional(field),
    fallback: isDefaulted(field) ? { value: field.fallback } : undefined,
  }))
  const schema = make<InferFields<F>, ReadFields<F>>(
    {
      type: 'struct',
      fields: Object.fromEntries(
        entries.map((e) => [
          e.key,
          {
            ast: e.schema.ast,
            optional: e.optional,
            ...(e.fallback !== undefined && { fallback: e.fallback }),
          },
        ]),
      ),
    },
    (input, path, mode) => {
      if (!isPlainObject(input)) return issue(path, `expected object, got ${describe(input)}`)
      const out: Record<string, unknown> = {}
      const issues: Issue[] = []
      for (const entry of entries) {
        const value = Object.hasOwn(input, entry.key) ? input[entry.key] : undefined
        if (value === undefined) {
          if (entry.fallback !== undefined && mode !== 'decode') out[entry.key] = entry.fallback.value
          else if (!entry.optional) issues.push({ path: [...path, entry.key], message: 'is required' })
          continue
        }
        const decoded = visit(entry.schema, value, [...path, entry.key], mode)
        isOk(decoded) ? (out[entry.key] = decoded.value) : issues.push(...decoded.error)
      }
      return issues.length > 0 ? err(issues) : ok(out)
    },
  )
  return { ...schema, fields }
}

export const union = <const M extends ReadonlyArray<Schema<any, any>>>(
  ...members: M
): Schema<Infer<M[number]>, Read<M[number]>> =>
  make({ type: 'union', members: members.map((m) => m.ast) }, (input, path, mode) => {
    if (mode === 'read') {
      const exact = firstMatch(members, input, path, 'exact')
      if (isOk(exact)) return exact
    }
    return firstMatch(members, input, path, mode)
  })

export const nullable = <A, R = A>(schema: Schema<A, R>): Schema<A | null, R | null> =>
  union(schema, literal(null))

export type InferVariants<Key extends string, V extends Readonly<Record<string, Fields>>> = {
  [K in keyof V]: Simplify<{ readonly [P in Key]: K } & InferFields<V[K]>>
}[keyof V]

export type ReadVariants<Key extends string, V extends Readonly<Record<string, Fields>>> = {
  [K in keyof V]: Simplify<{ readonly [P in Key]: K } & ReadFields<V[K]>>
}[keyof V]

export const variants = <Key extends string, const V extends Readonly<Record<string, Fields>>>(
  key: Key,
  cases: V,
): Schema<InferVariants<Key, V>, ReadVariants<Key, V>> => {
  const names = Object.keys(cases)
  const schemas = Object.fromEntries(
    names.map((name) => [name, struct({ [key]: literal(name), ...cases[name] } as Fields)]),
  ) as Record<string, Schema<any, any>>
  return make({ type: 'union', members: names.map((name) => schemas[name]!.ast) }, (input, path, mode) => {
    if (!isPlainObject(input)) return issue(path, `expected object, got ${describe(input)}`)
    const tag = Object.hasOwn(input, key) ? input[key] : undefined
    if (typeof tag !== 'string' || !Object.hasOwn(schemas, tag))
      return issue([...path, key], `expected ${names.map((n) => JSON.stringify(n)).join(' | ')}`)
    return visit(schemas[tag]!, input, path, mode)
  })
}

/**
 * Variants a newer server may add to. Decodes like `variants`; reads an object whose `key` names no
 * variant as `fallback`, while a known variant that does not read still fails.
 */
export const openVariants = <Key extends string, const V extends Readonly<Record<string, Fields>>, const F>(
  key: Key,
  cases: V,
  fallback: F,
): Schema<InferVariants<Key, V>, ReadVariants<Key, V> | F> => {
  const closed = variants(key, cases)
  return make({ type: 'tolerant', inner: closed.ast, fallback }, (input, path, mode) =>
    mode === 'read' &&
    isPlainObject(input) &&
    typeof input[key] === 'string' &&
    !Object.hasOwn(cases, input[key])
      ? ok(fallback)
      : visit(closed, input, path, mode),
  )
}

export const refine =
  <A>(name: string, predicate: (a: A) => boolean, message = `expected ${name}`) =>
  <R = A>(schema: Schema<A, R>): Schema<A, R> =>
    make({ type: 'refined', inner: schema.ast, name }, (input, path, mode) => {
      const decoded = visit(schema, input, path, mode)
      if (!isOk(decoded)) return decoded
      return predicate(decoded.value as A) ? decoded : issue(path, message)
    })

export const brand =
  <Tag extends string>() =>
  <A>(schema: Schema<A>): Schema<Brand<A, Tag>> =>
    schema as unknown as Schema<Brand<A, Tag>>

export const formatIssues = (issues: ReadonlyArray<Issue>): string =>
  issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')

export type JsonSchema = { readonly [key: string]: unknown }

export const toJsonSchema = (ast: Ast): JsonSchema => {
  switch (ast.type) {
    case 'string':
      return {
        type: 'string',
        ...(ast.minLength !== undefined && { minLength: ast.minLength }),
        ...(ast.maxLength !== undefined && { maxLength: ast.maxLength }),
        ...(ast.pattern !== undefined && { pattern: ast.pattern }),
      }
    case 'number':
      return {
        type: ast.integer ? 'integer' : 'number',
        ...(ast.min !== undefined && { minimum: ast.min }),
        ...(ast.max !== undefined && { maximum: ast.max }),
      }
    case 'boolean':
      return { type: 'boolean' }
    case 'unknown':
      return {}
    case 'literal':
      return ast.values.length === 1 ? { const: ast.values[0] } : { enum: ast.values }
    case 'array':
      return {
        type: 'array',
        items: toJsonSchema(ast.items),
        ...(ast.minItems !== undefined && { minItems: ast.minItems }),
        ...(ast.maxItems !== undefined && { maxItems: ast.maxItems }),
      }
    case 'record':
      return { type: 'object', additionalProperties: toJsonSchema(ast.values) }
    case 'struct':
      return {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(ast.fields).map(([k, f]) => [
            k,
            f.fallback === undefined
              ? toJsonSchema(f.ast)
              : { ...toJsonSchema(f.ast), default: f.fallback.value },
          ]),
        ),
        required: Object.entries(ast.fields)
          .filter(([, f]) => !f.optional)
          .map(([k]) => k),
      }
    case 'union':
      return { anyOf: ast.members.map(toJsonSchema) }
    case 'refined':
    case 'tolerant':
      return toJsonSchema(ast.inner)
  }
}

type Path = ReadonlyArray<string | number>

type Walk = Schema<unknown>['walk']

type OptionalKeys<F> = { [K in keyof F]: F[K] extends Optional<any, any> ? K : never }[keyof F]

type ReadOptionalKeys<F> = {
  [K in keyof F]: F[K] extends Defaulted<any, any> ? never : F[K] extends Optional<any, any> ? K : never
}[keyof F]

function numeric(integer: boolean) {
  return (options: NumberOptions = {}): Schema<number> => {
    const { min, max } = options
    return make(
      { type: 'number', integer, ...(min !== undefined && { min }), ...(max !== undefined && { max }) },
      (input, path, mode) => {
        if (typeof input !== 'number' || !Number.isFinite(input))
          return issue(path, `expected ${integer ? 'integer' : 'number'}, got ${describe(input)}`)
        if (integer && !Number.isInteger(input)) return issue(path, 'expected integer, got fraction')
        if (min !== undefined && input < min) return issue(path, `expected at least ${min}`)
        if (mode === 'decode' && max !== undefined && input > max)
          return issue(path, `expected at most ${max}`)
        return ok(input)
      },
    )
  }
}

function make<A, R = A>(ast: Ast, walk: Walk): Schema<A, R> {
  const at = (input: unknown, path: Path) => walk(input, path, 'decode') as Result<A, ReadonlyArray<Issue>>
  const readAt = (input: unknown, path: Path) => walk(input, path, 'read') as Result<R, ReadonlyArray<Issue>>
  return {
    ast,
    at,
    readAt,
    walk,
    decode: (input) => at(input, []),
    read: (input) => readAt(input, []),
    is: (input): input is A => isOk(at(input, [])),
  }
}

function visit(
  schema: Schema<unknown, unknown>,
  input: unknown,
  path: Path,
  mode: Mode,
): Result<unknown, ReadonlyArray<Issue>> {
  return schema.walk(input, path, mode)
}

function firstMatch(
  members: ReadonlyArray<Schema<unknown, unknown>>,
  input: unknown,
  path: Path,
  mode: Mode,
): Result<unknown, ReadonlyArray<Issue>> {
  const issues: Issue[] = []
  for (const member of members) {
    const decoded = visit(member, input, path, mode)
    if (isOk(decoded)) return decoded
    issues.push(...decoded.error)
  }
  return err(issues.length > 0 ? issues : [{ path, message: 'no union member to match' }])
}

function issue(path: Path, message: string): Result<never, ReadonlyArray<Issue>> {
  return err([{ path, message }])
}

function describe(input: unknown): string {
  return input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isOptional(field: Schema<any, any> | Optional<any, any>): field is Optional<any, any> {
  return 'optional' in field
}

function isDefaulted(field: Schema<any, any> | Optional<any, any>): field is Defaulted<any, any> {
  return 'fallback' in field
}

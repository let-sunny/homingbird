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
  | {
      readonly type: 'struct'
      readonly fields: Readonly<Record<string, { readonly ast: Ast; readonly optional: boolean }>>
    }
  | { readonly type: 'union'; readonly members: ReadonlyArray<Ast> }
  | { readonly type: 'refined'; readonly inner: Ast; readonly name: string }
export interface Issue {
  readonly path: ReadonlyArray<string | number>
  readonly message: string
}
export interface Schema<out A> {
  readonly ast: Ast
  readonly decode: (input: unknown) => Result<A, ReadonlyArray<Issue>>
  readonly is: (input: unknown) => input is A
  readonly at: (input: unknown, path: Path) => Result<A, ReadonlyArray<Issue>>
}
export interface Optional<out A> {
  readonly optional: Schema<A>
}
export type Infer<S> = S extends Schema<infer A> ? A : S extends Optional<infer A> ? A | undefined : never
const make = <A>(
  ast: Ast,
  at: (input: unknown, path: Path) => Result<A, ReadonlyArray<Issue>>,
): Schema<A> => ({
  ast,
  at,
  decode: (input) => at(input, []),
  is: (input): input is A => isOk(at(input, [])),
})
const issue = (path: Path, message: string): Result<never, ReadonlyArray<Issue>> => err([{ path, message }])
const describe = (input: unknown): string =>
  input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input
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
    (input, path) => {
      if (typeof input !== 'string') return issue(path, `expected string, got ${describe(input)}`)
      if (minLength !== undefined && input.length < minLength)
        return issue(path, `expected at least ${minLength} characters`)
      if (maxLength !== undefined && input.length > maxLength)
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
const numeric =
  (integer: boolean) =>
  (options: NumberOptions = {}): Schema<number> => {
    const { min, max } = options
    return make(
      { type: 'number', integer, ...(min !== undefined && { min }), ...(max !== undefined && { max }) },
      (input, path) => {
        if (typeof input !== 'number' || !Number.isFinite(input))
          return issue(path, `expected ${integer ? 'integer' : 'number'}, got ${describe(input)}`)
        if (integer && !Number.isInteger(input)) return issue(path, 'expected integer, got fraction')
        if (min !== undefined && input < min) return issue(path, `expected at least ${min}`)
        if (max !== undefined && input > max) return issue(path, `expected at most ${max}`)
        return ok(input)
      },
    )
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
export interface ArrayOptions {
  readonly minItems?: number
  readonly maxItems?: number
}
export const array = <A>(items: Schema<A>, options: ArrayOptions = {}): Schema<ReadonlyArray<A>> => {
  const { minItems, maxItems } = options
  return make(
    {
      type: 'array',
      items: items.ast,
      ...(minItems !== undefined && { minItems }),
      ...(maxItems !== undefined && { maxItems }),
    },
    (input, path) => {
      if (!Array.isArray(input)) return issue(path, `expected array, got ${describe(input)}`)
      if (minItems !== undefined && input.length < minItems)
        return issue(path, `expected at least ${minItems} items`)
      if (maxItems !== undefined && input.length > maxItems)
        return issue(path, `expected at most ${maxItems} items`)
      const out: A[] = []
      const issues: Issue[] = []
      input.forEach((item, index) => {
        const decoded = items.at(item, [...path, index])
        isOk(decoded) ? out.push(decoded.value) : issues.push(...decoded.error)
      })
      return issues.length > 0 ? err(issues) : ok(out)
    },
  )
}
const isPlainObject = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input)
export const record = <A>(values: Schema<A>): Schema<Readonly<Record<string, A>>> =>
  make({ type: 'record', values: values.ast }, (input, path) => {
    if (!isPlainObject(input)) return issue(path, `expected object, got ${describe(input)}`)
    const out: Array<[string, A]> = []
    const issues: Issue[] = []
    for (const [key, value] of Object.entries(input)) {
      const decoded = values.at(value, [...path, key])
      isOk(decoded) ? out.push([key, decoded.value]) : issues.push(...decoded.error)
    }
    return issues.length > 0 ? err(issues) : ok(Object.fromEntries(out))
  })
export const optional = <A>(schema: Schema<A>): Optional<A> => ({ optional: schema })
export type Fields = Readonly<Record<string, Schema<any> | Optional<any>>>
export type InferFields<F> = Simplify<
  { readonly [K in Exclude<keyof F, OptionalKeys<F>>]: F[K] extends Schema<infer A> ? A : never } & {
    readonly [K in OptionalKeys<F>]?: F[K] extends Optional<infer A> ? A : never
  }
>
const isOptional = (field: Schema<any> | Optional<any>): field is Optional<any> => 'optional' in field
export interface StructSchema<F extends Fields> extends Schema<InferFields<F>> {
  readonly fields: F
}
export const struct = <F extends Fields>(fields: F): StructSchema<F> => {
  const entries = Object.entries(fields).map(([key, field]) => ({
    key,
    schema: isOptional(field) ? field.optional : field,
    optional: isOptional(field),
  }))
  const schema = make<InferFields<F>>(
    {
      type: 'struct',
      fields: Object.fromEntries(entries.map((e) => [e.key, { ast: e.schema.ast, optional: e.optional }])),
    },
    (input, path) => {
      if (!isPlainObject(input)) return issue(path, `expected object, got ${describe(input)}`)
      const out: Record<string, unknown> = {}
      const issues: Issue[] = []
      for (const entry of entries) {
        const value = Object.hasOwn(input, entry.key) ? input[entry.key] : undefined
        if (value === undefined) {
          if (!entry.optional) issues.push({ path: [...path, entry.key], message: 'is required' })
          continue
        }
        const decoded = entry.schema.at(value, [...path, entry.key])
        isOk(decoded) ? (out[entry.key] = decoded.value) : issues.push(...decoded.error)
      }
      return issues.length > 0 ? err(issues) : ok(out as InferFields<F>)
    },
  )
  return { ...schema, fields }
}
export const union = <const M extends ReadonlyArray<Schema<any>>>(...members: M): Schema<Infer<M[number]>> =>
  make({ type: 'union', members: members.map((m) => m.ast) }, (input, path) => {
    const issues: Issue[] = []
    for (const member of members) {
      const decoded = member.at(input, path)
      if (isOk(decoded)) return decoded
      issues.push(...decoded.error)
    }
    return err(issues.length > 0 ? issues : [{ path, message: 'no union member to match' }])
  })
export const nullable = <A>(schema: Schema<A>): Schema<A | null> => union(schema, literal(null))
export type InferVariants<Key extends string, V extends Readonly<Record<string, Fields>>> = {
  [K in keyof V]: Simplify<{ readonly [P in Key]: K } & InferFields<V[K]>>
}[keyof V]
export const variants = <Key extends string, const V extends Readonly<Record<string, Fields>>>(
  key: Key,
  cases: V,
): Schema<InferVariants<Key, V>> => {
  const names = Object.keys(cases)
  const schemas = Object.fromEntries(
    names.map((name) => [name, struct({ [key]: literal(name), ...cases[name] } as Fields)]),
  ) as Record<string, Schema<any>>
  return make({ type: 'union', members: names.map((name) => schemas[name]!.ast) }, (input, path) => {
    if (!isPlainObject(input)) return issue(path, `expected object, got ${describe(input)}`)
    const tag = Object.hasOwn(input, key) ? input[key] : undefined
    if (typeof tag !== 'string' || !Object.hasOwn(schemas, tag))
      return issue([...path, key], `expected ${names.map((n) => JSON.stringify(n)).join(' | ')}`)
    return schemas[tag]!.at(input, path)
  })
}
export const refine =
  <A>(name: string, predicate: (a: A) => boolean, message = `expected ${name}`) =>
  (schema: Schema<A>): Schema<A> =>
    make({ type: 'refined', inner: schema.ast, name }, (input, path) => {
      const decoded = schema.at(input, path)
      if (!isOk(decoded)) return decoded
      return predicate(decoded.value) ? decoded : issue(path, message)
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
        properties: Object.fromEntries(Object.entries(ast.fields).map(([k, f]) => [k, toJsonSchema(f.ast)])),
        required: Object.entries(ast.fields)
          .filter(([, f]) => !f.optional)
          .map(([k]) => k),
      }
    case 'union':
      return { anyOf: ast.members.map(toJsonSchema) }
    case 'refined':
      return toJsonSchema(ast.inner)
  }
}

type Path = ReadonlyArray<string | number>

type OptionalKeys<F> = { [K in keyof F]: F[K] extends Optional<any> ? K : never }[keyof F]

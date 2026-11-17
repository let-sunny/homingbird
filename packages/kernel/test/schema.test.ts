import { describe, expect, expectTypeOf, it } from 'vitest'
import { type Brand, Schema as S, ok } from '../src/index.ts'

const issuesOf = (schema: S.Schema<unknown>, input: unknown) => {
  const decoded = schema.decode(input)
  return decoded._tag === 'Err'
    ? decoded.error.map((issue) => `${issue.path.join('.')}|${issue.message}`)
    : []
}

const Even = S.refine<number>('even', (n) => n % 2 === 0)(S.int())
const UserId = S.brand<'UserId'>()(S.string({ pattern: /^u_[a-z]{3}$/ }))
const User = S.struct({
  id: UserId,
  name: S.string({ minLength: 1, maxLength: 20 }),
  age: S.optional(S.int({ min: 0, max: 150 })),
  tags: S.array(S.string({ maxLength: 5 }), { maxItems: 3 }),
  score: S.nullable(S.number({ min: 0, max: 1 })),
})
const Event = S.variants('type', {
  created: { user: User },
  renamed: { id: UserId, name: S.string() },
  removed: {},
})
const everything = [
  S.string(),
  S.string({ minLength: 2, maxLength: 4 }),
  UserId,
  S.number(),
  S.number({ min: -1, max: 1 }),
  S.int(),
  S.int({ min: 3, max: 9 }),
  S.boolean,
  S.unknown,
  S.literal('a', 2, true, null),
  S.literal('only'),
  S.array(S.int()),
  S.array(S.boolean, { minItems: 1, maxItems: 2 }),
  S.record(S.int()),
  S.union(S.string(), S.int()),
  S.nullable(S.boolean),
  User,
  Event,
] as const

describe('primitives', () => {
  it('string checks type, length and pattern', () => {
    expect(S.string().decode('x')).toEqual(ok('x'))
    expect(issuesOf(S.string(), 1)).toEqual(['|expected string, got number'])
    expect(issuesOf(S.string(), null)).toEqual(['|expected string, got null'])
    expect(issuesOf(S.string(), [])).toEqual(['|expected string, got array'])
    const bounded = S.string({ minLength: 2, maxLength: 3, pattern: /^a/ })
    expect(bounded.decode('ab')).toEqual(ok('ab'))
    expect(bounded.decode('abc')).toEqual(ok('abc'))
    expect(issuesOf(bounded, 'a')).toEqual(['|expected at least 2 characters'])
    expect(issuesOf(bounded, 'abcd')).toEqual(['|expected at most 3 characters'])
    expect(issuesOf(bounded, 'ba')).toEqual(['|expected to match ^a'])
  })

  it('number and int check type, finiteness, integrality and bounds', () => {
    expect(S.number().decode(1.5)).toEqual(ok(1.5))
    expect(issuesOf(S.number(), '1')).toEqual(['|expected number, got string'])
    expect(issuesOf(S.number(), Number.NaN)).toEqual(['|expected number, got number'])
    expect(issuesOf(S.number(), Number.POSITIVE_INFINITY)).toEqual(['|expected number, got number'])
    expect(issuesOf(S.int(), 1.5)).toEqual(['|expected integer, got fraction'])
    expect(issuesOf(S.int(), true)).toEqual(['|expected integer, got boolean'])
    const bounded = S.int({ min: 1, max: 3 })
    expect([1, 2, 3].map((n) => bounded.is(n))).toEqual([true, true, true])
    expect(issuesOf(bounded, 0)).toEqual(['|expected at least 1'])
    expect(issuesOf(bounded, 4)).toEqual(['|expected at most 3'])
  })

  it('boolean, unknown and literal', () => {
    expect(S.boolean.decode(false)).toEqual(ok(false))
    expect(issuesOf(S.boolean, 0)).toEqual(['|expected boolean, got number'])
    expect(S.unknown.decode({ any: [1] })).toEqual(ok({ any: [1] }))
    const literal = S.literal('a', 2, null)
    expect(['a', 2, null].map((value) => literal.is(value))).toEqual([true, true, true])
    expect(issuesOf(literal, 'b')).toEqual(['|expected "a" | 2 | null'])
  })
})

describe('composites', () => {
  it('array checks type and size and reports every bad item with its index', () => {
    const list = S.array(S.int(), { minItems: 1, maxItems: 3 })
    expect(list.decode([1, 2])).toEqual(ok([1, 2]))
    expect(issuesOf(list, {})).toEqual(['|expected array, got object'])
    expect(issuesOf(list, [])).toEqual(['|expected at least 1 items'])
    expect(issuesOf(list, [1, 2, 3, 4])).toEqual(['|expected at most 3 items'])
    expect(issuesOf(list, [1, 'x', 2.5])).toEqual([
      '1|expected integer, got string',
      '2|expected integer, got fraction',
    ])
  })

  it('record checks every value and keeps its keys', () => {
    const counts = S.record(S.int())
    expect(counts.decode({ a: 1, b: 2 })).toEqual(ok({ a: 1, b: 2 }))
    expect(issuesOf(counts, [])).toEqual(['|expected object, got array'])
    expect(issuesOf(counts, { a: 'x', b: 1, c: null })).toEqual([
      'a|expected integer, got string',
      'c|expected integer, got null',
    ])
    expect(counts.decode(JSON.parse('{"__proto__": 1}'))).toEqual(ok(JSON.parse('{"__proto__": 1}')))
  })

  it('struct drops unknown keys, omits absent optionals, and reports every problem with its path', () => {
    const input = { id: 'u_abc', name: 'Pip', tags: ['a'], score: null, extra: true, age: undefined }
    expect(User.decode(input)).toEqual(ok({ id: 'u_abc', name: 'Pip', tags: ['a'], score: null }))
    expect(User.decode({ ...input, age: 3 })).toMatchObject({ value: { age: 3 } })
    expect(issuesOf(User, 'no')).toEqual(['|expected object, got string'])
    expect(issuesOf(User, { id: 'bad', tags: ['toolong'], score: 2, age: -1 })).toEqual([
      'id|expected to match ^u_[a-z]{3}$',
      'name|is required',
      'age|expected at least 0',
      'tags.0|expected at most 5 characters',
      'score|expected at most 1',
      'score|expected null',
    ])
    expect(Object.keys(User.fields)).toEqual(['id', 'name', 'age', 'tags', 'score'])
  })

  it('struct ignores inherited properties', () => {
    const inherited = Object.create({ name: 'inherited' })
    expect(issuesOf(S.struct({ name: S.string() }), inherited)).toEqual(['name|is required'])
    expect(S.struct({ toString: S.optional(S.string()) }).decode({})).toEqual(ok({}))
  })

  it('union takes the first member that accepts and otherwise reports every member', () => {
    const either = S.union(S.int(), S.string())
    expect(either.decode(1)).toEqual(ok(1))
    expect(either.decode('a')).toEqual(ok('a'))
    expect(issuesOf(either, true)).toEqual([
      '|expected integer, got boolean',
      '|expected string, got boolean',
    ])
    expect(issuesOf(S.union(), 1)).toEqual(['|no union member to match'])
    expect(S.nullable(S.int()).decode(null)).toEqual(ok(null))
  })

  it('variants dispatch on the discriminator and report against the named variant', () => {
    expect(Event.decode({ type: 'removed', junk: 1 })).toEqual(ok({ type: 'removed' }))
    expect(Event.decode({ type: 'renamed', id: 'u_abc', name: 'n' })).toMatchObject({ _tag: 'Ok' })
    expect(issuesOf(Event, 1)).toEqual(['|expected object, got number'])
    expect(issuesOf(Event, {})).toEqual(['type|expected "created" | "renamed" | "removed"'])
    expect(issuesOf(Event, { type: 'toString' })).toEqual(['type|expected "created" | "renamed" | "removed"'])
    expect(issuesOf(Event, { type: 7 })).toEqual(['type|expected "created" | "renamed" | "removed"'])
    expect(issuesOf(Event, { type: 'renamed', id: 'x' })).toEqual([
      'id|expected to match ^u_[a-z]{3}$',
      'name|is required',
    ])
    const nested = S.struct({ event: Event })
    expect(issuesOf(nested, { event: {} })).toEqual(['event.type|expected "created" | "renamed" | "removed"'])
  })
})

describe('refinements', () => {
  it('refine narrows after the inner schema and names itself', () => {
    expect(Even.decode(2)).toEqual(ok(2))
    expect(issuesOf(Even, 3)).toEqual(['|expected even'])
    expect(issuesOf(Even, 'x')).toEqual(['|expected integer, got string'])
    expect(Even.ast).toMatchObject({
      type: 'refined',
      name: 'even',
      inner: { type: 'number', integer: true },
    })
    expect(issuesOf(S.refine<number>('odd', (n) => n % 2 === 1, 'must be odd')(S.int()), 2)).toEqual([
      '|must be odd',
    ])
  })

  it('brand changes only the static type', () => {
    expectTypeOf<S.Infer<typeof UserId>>().toEqualTypeOf<Brand<string, 'UserId'>>()
    expect(UserId.decode('u_abc')).toEqual(ok('u_abc'))
    expect(UserId.ast).toEqual({ type: 'string', pattern: '^u_[a-z]{3}$' })
  })
})

describe('static types', () => {
  it('infers optional fields, readonly arrays and variants', () => {
    type UserType = S.Infer<typeof User>
    expectTypeOf<UserType['age']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<UserType['tags']>().toEqualTypeOf<ReadonlyArray<string>>()
    expectTypeOf<UserType['score']>().toEqualTypeOf<number | null>()
    expectTypeOf<{} extends Pick<UserType, 'age'> ? true : false>().toEqualTypeOf<true>()
    expectTypeOf<{} extends Pick<UserType, 'name'> ? true : false>().toEqualTypeOf<false>()
    type EventType = S.Infer<typeof Event>
    expectTypeOf<EventType['type']>().toEqualTypeOf<'created' | 'renamed' | 'removed'>()
    expectTypeOf<Extract<EventType, { type: 'renamed' }>['name']>().toEqualTypeOf<string>()
    expectTypeOf<S.Infer<ReturnType<typeof S.optional<number>>>>().toEqualTypeOf<number | undefined>()
    expectTypeOf<S.Infer<(typeof everything)[9]>>().toEqualTypeOf<'a' | 2 | true | null>()
  })
})

describe('descriptions', () => {
  it('records exactly the constraints that were given', () => {
    expect(S.string().ast).toEqual({ type: 'string' })
    expect(S.string({ minLength: 0 }).ast).toEqual({ type: 'string', minLength: 0 })
    expect(S.string({ maxLength: 0 }).ast).toEqual({ type: 'string', maxLength: 0 })
    expect(S.string({ minLength: 1, maxLength: 2, pattern: /^a$/ }).ast).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 2,
      pattern: '^a$',
    })
    expect(S.number().ast).toEqual({ type: 'number', integer: false })
    expect(S.int({ min: 0 }).ast).toEqual({ type: 'number', integer: true, min: 0 })
    expect(S.int({ max: 0 }).ast).toEqual({ type: 'number', integer: true, max: 0 })
    expect(S.array(S.boolean).ast).toEqual({ type: 'array', items: { type: 'boolean' } })
    expect(S.array(S.boolean, { minItems: 0 }).ast).toEqual({
      type: 'array',
      items: { type: 'boolean' },
      minItems: 0,
    })
    expect(S.array(S.boolean, { maxItems: 0 }).ast).toEqual({
      type: 'array',
      items: { type: 'boolean' },
      maxItems: 0,
    })
    expect(S.union(S.boolean, S.int()).ast).toEqual({
      type: 'union',
      members: [{ type: 'boolean' }, { type: 'number', integer: true }],
    })
    expect(Even.ast).toEqual({ type: 'refined', name: 'even', inner: { type: 'number', integer: true } })
  })

  it('applies a bound of zero like any other bound', () => {
    expect(S.string({ maxLength: 0 }).is('a')).toBe(false)
    expect(S.string({ minLength: 0 }).is('')).toBe(true)
    expect(S.array(S.int(), { maxItems: 0 }).is([1])).toBe(false)
    expect(S.array(S.int(), { minItems: 2 }).is([1, 2])).toBe(true)
    expect(S.int({ min: 0 }).is(-1)).toBe(false)
    expect(S.int({ max: 0 }).is(1)).toBe(false)
    expect(S.toJsonSchema(S.string({ minLength: 0, maxLength: 0 }).ast)).toEqual({
      type: 'string',
      minLength: 0,
      maxLength: 0,
    })
    expect(S.toJsonSchema(S.int({ min: 0, max: 0 }).ast)).toEqual({ type: 'integer', minimum: 0, maximum: 0 })
    expect(S.toJsonSchema(S.array(S.int(), { minItems: 0, maxItems: 0 }).ast)).toEqual({
      type: 'array',
      items: { type: 'integer' },
      minItems: 0,
      maxItems: 0,
    })
    expect(S.toJsonSchema(S.string().ast)).toEqual({ type: 'string' })
    expect(S.toJsonSchema(S.array(S.int()).ast)).toEqual({ type: 'array', items: { type: 'integer' } })
  })
})

describe('derivations', () => {
  it('formatIssues joins paths and messages', () => {
    expect(S.formatIssues([])).toBe('')
    expect(
      S.formatIssues([
        { path: [], message: 'top' },
        { path: ['a', 0, 'b'], message: 'deep' },
      ]),
    ).toBe('top; a.0.b: deep')
  })

  it('toJsonSchema describes every kind of schema', () => {
    expect(S.toJsonSchema(User.ast)).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^u_[a-z]{3}$' },
        name: { type: 'string', minLength: 1, maxLength: 20 },
        age: { type: 'integer', minimum: 0, maximum: 150 },
        tags: { type: 'array', items: { type: 'string', maxLength: 5 }, maxItems: 3 },
        score: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { const: null }] },
      },
      required: ['id', 'name', 'tags', 'score'],
    })
    expect(S.toJsonSchema(S.string().ast)).toEqual({ type: 'string' })
    expect(S.toJsonSchema(S.number().ast)).toEqual({ type: 'number' })
    expect(S.toJsonSchema(S.boolean.ast)).toEqual({ type: 'boolean' })
    expect(S.toJsonSchema(S.unknown.ast)).toEqual({})
    expect(S.toJsonSchema(S.literal('a', 'b').ast)).toEqual({ enum: ['a', 'b'] })
    expect(S.toJsonSchema(S.array(S.int(), { minItems: 1 }).ast)).toEqual({
      type: 'array',
      items: { type: 'integer' },
      minItems: 1,
    })
    expect(S.toJsonSchema(S.record(S.boolean).ast)).toEqual({
      type: 'object',
      additionalProperties: { type: 'boolean' },
    })
    expect(S.toJsonSchema(Even.ast)).toEqual({ type: 'integer' })
    expect(S.toJsonSchema(Event.ast)).toMatchObject({
      anyOf: [
        { properties: { type: { const: 'created' } }, required: ['type', 'user'] },
        { properties: { type: { const: 'renamed' } } },
        { properties: { type: { const: 'removed' } }, required: ['type'] },
      ],
    })
  })
})

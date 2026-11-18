import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Schema as S } from '../src/index.ts'
import { arbitrary } from '../src/testing.ts'

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

describe('generated values', () => {
  it.each(everything.map((schema, index) => [index, schema] as const))(
    'schema %i accepts everything generated from it, and decoding is idempotent',
    (_, schema) => {
      fc.assert(
        fc.property(arbitrary(schema as S.Schema<unknown>), (value) => {
          const once = schema.decode(value)
          expect(once._tag).toBe('Ok')
          expect(schema.decode((once as { value: unknown }).value)).toEqual(once)
          expect(schema.is(value)).toBe(true)
        }),
        { numRuns: 60 },
      )
    },
  )

  it('uses a supplied generator for a refinement and filters otherwise', () => {
    const evens = fc.integer().map((n) => n * 2)
    fc.assert(
      fc.property(arbitrary(Even, { even: evens }), (n) => n % 2 === 0),
      { numRuns: 50 },
    )
    fc.assert(
      fc.property(arbitrary(Even), (n) => n % 2 === 0),
      { numRuns: 50 },
    )
    const nested = S.struct({ n: Even })
    fc.assert(
      fc.property(arbitrary(nested), (value) => nested.is(value)),
      { numRuns: 30 },
    )
  })

  it('generates strings within a pattern’s length bounds', () => {
    const code = S.string({ pattern: /^[a-z]+$/, minLength: 2, maxLength: 4 })
    fc.assert(
      fc.property(arbitrary(code), (s) => s.length >= 2 && s.length <= 4 && /^[a-z]+$/.test(s)),
      {
        numRuns: 50,
      },
    )
    const open = S.string({ pattern: /^[a-z]*$/ })
    fc.assert(
      fc.property(arbitrary(open), (s) => open.is(s)),
      { numRuns: 30 },
    )
  })

  it('struct values sometimes omit optional fields and sometimes include them', () => {
    const samples = fc.sample(arbitrary(User), 200)
    expect(samples.some((user) => user.age === undefined)).toBe(true)
    expect(samples.some((user) => user.age !== undefined)).toBe(true)
  })
})

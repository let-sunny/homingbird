import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { compile, isPlural, placeholdersOf } from '../src/messages.ts'

const source = {
  plain: 'Hello',
  greeting: 'Hello, {name}',
  counted: { one: '{count} draft for {name}', other: '{count} drafts for {name}' },
  nested: { deep: 'Read by {read} of {of}', empty: '' },
} as const

describe('compile', () => {
  const english = compile<typeof source>('en', source)

  it('keeps a message without placeholders as plain text', () => {
    expect(english.plain).toBe('Hello')
    expect(english.nested.empty).toBe('')
  })

  it('fills named placeholders, in nested groups too', () => {
    expect(english.greeting({ name: 'Ana' })).toBe('Hello, Ana')
    expect(english.nested.deep({ read: 2, of: 3 })).toBe('Read by 2 of 3')
  })

  it('formats numbers the way the language writes them', () => {
    expect(english.nested.deep({ read: 1200, of: 3400 })).toBe('Read by 1,200 of 3,400')
    expect(compile<typeof source>('de', source).nested.deep({ read: 1200, of: 3400 })).toBe(
      'Read by 1.200 of 3.400',
    )
  })

  it('picks the plural form the language needs for the count', () => {
    expect(english.counted({ count: 1, name: 'Ana' })).toBe('1 draft for Ana')
    expect(english.counted({ count: 0, name: 'Ana' })).toBe('0 drafts for Ana')
    expect(english.counted({ count: 2, name: 'Ana' })).toBe('2 drafts for Ana')
  })

  it('lets a language declare only the other form, as Korean does', () => {
    const korean = compile<typeof source>('ko', {
      plain: '안녕하세요',
      greeting: '{name} 님, 안녕하세요',
      counted: { other: '{name} 님의 초안 {count}개' },
      nested: { deep: '{of}명 중 {read}명 읽음', empty: '' },
    })
    fc.assert(
      fc.property(fc.nat({ max: 999 }), (count) => {
        expect(korean.counted({ count, name: 'Ana' })).toBe(`Ana 님의 초안 ${count}개`)
      }),
    )
  })

  it('falls back to the other form when a language leaves a form out', () => {
    const terse = compile<typeof source>('en', { ...source, counted: { other: '{count} × {name}' } })
    expect(terse.counted({ count: 1, name: 'Ana' })).toBe('1 × Ana')
  })

  it('leaves a placeholder it has no value for visible, so a missing value shows in review', () => {
    expect(english.greeting({} as never)).toBe('Hello, {name}')
  })

  it('types each message by its placeholders', () => {
    expectTypeOf(english.plain).toEqualTypeOf<string>()
    expectTypeOf(english.greeting).parameter(0).toEqualTypeOf<Readonly<Record<'name', string | number>>>()
    expectTypeOf(english.counted).parameter(0).toHaveProperty('count').toEqualTypeOf<number>()
    expectTypeOf(english.counted).parameter(0).toHaveProperty('name')
  })
})

describe('placeholdersOf', () => {
  it('lists each named placeholder once, sorted', () => {
    expect(placeholdersOf('{b} and {a} and {b}')).toEqual(['a', 'b'])
    expect(placeholdersOf('no placeholders')).toEqual([])
  })
})

describe('isPlural', () => {
  it('recognizes a group of plural forms with an other form', () => {
    expect(isPlural({ one: 'a', other: 'b' })).toBe(true)
    expect(isPlural({ other: 'b' })).toBe(true)
  })

  it('does not mistake a record of messages for plural forms', () => {
    expect(isPlural({ one: 'a' })).toBe(false)
    expect(isPlural({ other: 'b', none: '' })).toBe(false)
    expect(isPlural('other')).toBe(false)
    expect(isPlural(null)).toBe(false)
  })
})

import { describe, expect, expectTypeOf, it } from 'vitest'
import { type ByTag, type TagOf, isTagged, match, matchValue, tagged } from '../src/index.ts'

const NotFound = tagged('NotFound')<{ readonly what: string }>()
type NotFound = ReturnType<typeof NotFound>
const Denied = tagged('Denied')()
type Denied = ReturnType<typeof Denied>
type Problem = NotFound | Denied

describe('data', () => {
  it('builds frozen tagged values', () => {
    const value = NotFound({ what: 'note' })
    expect(value).toEqual({ _tag: 'NotFound', what: 'note' })
    expect(Object.isFrozen(value)).toBe(true)
    expect(NotFound.tag).toBe('NotFound')
  })

  it('builds field-less variants without arguments', () => {
    expect(Denied()).toEqual({ _tag: 'Denied' })
  })

  it('the tag wins over a field named _tag', () => {
    const Odd = tagged('Odd')<{ readonly _tag: string }>()
    expect(Odd({ _tag: 'Even' } as never)._tag).toBe('Odd')
  })

  it('guards by tag', () => {
    expect(NotFound.is(NotFound({ what: 'x' }))).toBe(true)
    expect(NotFound.is(Denied())).toBe(false)
    expect(NotFound.is({ _tag: 'NotFound' })).toBe(true)
    expect(NotFound.is(null)).toBe(false)
    expect(NotFound.is('NotFound')).toBe(false)
  })

  it('isTagged requires an object with a string _tag', () => {
    expect(isTagged({ _tag: 'A' })).toBe(true)
    expect(isTagged({ _tag: 1 })).toBe(false)
    expect(isTagged({})).toBe(false)
    expect(isTagged(null)).toBe(false)
    expect(isTagged(undefined)).toBe(false)
    expect(isTagged('A')).toBe(false)
  })

  it('match dispatches on _tag', () => {
    const show = match<Problem, string>({ NotFound: (e) => `missing ${e.what}`, Denied: () => 'denied' })
    expect(show(NotFound({ what: 'note' }))).toBe('missing note')
    expect(show(Denied())).toBe('denied')
  })

  it('matchValue dispatches on a literal', () => {
    const size = matchValue<'s' | 'l', number>({ s: () => 1, l: () => 2 })
    expect(size('s')).toBe(1)
    expect(size('l')).toBe(2)
  })

  it('types', () => {
    expectTypeOf<NotFound>().toEqualTypeOf<{ readonly _tag: 'NotFound'; readonly what: string }>()
    expectTypeOf<Denied>().toEqualTypeOf<{ readonly _tag: 'Denied' }>()
    expectTypeOf<TagOf<Problem>>().toEqualTypeOf<'NotFound' | 'Denied'>()
    expectTypeOf<ByTag<Problem, 'Denied'>>().toEqualTypeOf<Denied>()
    // @ts-expect-error a case is missing
    match<Problem, string>({ NotFound: () => '' })
    // @ts-expect-error an unknown case is present
    match<Problem, string>({ NotFound: () => '', Denied: () => '', Extra: () => '' })
    // @ts-expect-error fields are required
    NotFound()
    // @ts-expect-error a literal case is missing
    matchValue<'s' | 'l', number>({ s: () => 1 })
  })
})

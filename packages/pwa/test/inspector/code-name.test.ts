import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type CodeName, codeNameIn, pathOf } from '../../src/inspector/code-name.ts'

describe('codeNameIn', () => {
  it('is the name of an own key of what the code made', () => {
    expect(codeNameIn({ 'notes.list': () => {} }, 'notes.list')).toBe('notes.list')
  })

  it('is null for anything else, whatever the text', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        fc.pre(text !== 'known')
        expect(codeNameIn({ known: 1 }, text)).toBeNull()
      }),
    )
    expect(codeNameIn({}, 'toString')).toBeNull()
    expect(codeNameIn({}, Symbol.iterator)).toBeNull()
  })
})

describe('pathOf', () => {
  it('names a part by the keys that lead to it', () => {
    const [outer, inner] = ['outer' as CodeName, 'inner' as CodeName]
    expect(pathOf(null, inner)).toBe('inner')
    expect(pathOf(outer, inner)).toBe('outer.inner')
  })
})

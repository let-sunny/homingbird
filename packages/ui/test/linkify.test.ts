import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { endsUnbalanced, textSegments } from '../src/linkify.ts'

describe('textSegments', () => {
  it('returns plain text unchanged', () => {
    expect([...textSegments('no links here')]).toEqual([{ type: 'text', value: 'no links here' }])
  })

  it('yields nothing for an empty string', () => {
    expect([...textSegments('')]).toEqual([])
  })

  it('splits out http and https addresses', () => {
    expect([...textSegments('see https://example.com/a?b=1 and http://x.test now')]).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://example.com/a?b=1' },
      { type: 'text', value: ' and ' },
      { type: 'link', value: 'http://x.test' },
      { type: 'text', value: ' now' },
    ])
  })

  it('leaves trailing punctuation and a closing bracket outside the link', () => {
    expect([...textSegments('(https://example.com/docs). Done')]).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', value: 'https://example.com/docs' },
      { type: 'text', value: '). Done' },
    ])
  })

  it('keeps balanced brackets inside the link', () => {
    expect([...textSegments('https://example.com/a_(b)')]).toEqual([
      { type: 'link', value: 'https://example.com/a_(b)' },
    ])
  })

  it('drops a closing bracket that closes text around a link whose own brackets balance', () => {
    expect([...textSegments('(https://en.wikipedia.org/wiki/Foo_(bar))')]).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', value: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
      { type: 'text', value: ')' },
    ])
  })

  it('drops an unopened closing bracket after a link that holds a balanced pair', () => {
    expect([...textSegments('see https://example.com/a_(b)_c)')]).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://example.com/a_(b)_c' },
      { type: 'text', value: ')' },
    ])
  })

  it('treats square brackets and braces the same way', () => {
    expect([...textSegments('[https://example.com/x_[1]] {https://example.com/y_{2}}.')]).toEqual([
      { type: 'text', value: '[' },
      { type: 'link', value: 'https://example.com/x_[1]' },
      { type: 'text', value: '] {' },
      { type: 'link', value: 'https://example.com/y_{2}' },
      { type: 'text', value: '}.' },
    ])
  })

  it('strips punctuation and brackets in any order', () => {
    expect([...textSegments('(see https://example.com/a).')]).toEqual([
      { type: 'text', value: '(see ' },
      { type: 'link', value: 'https://example.com/a' },
      { type: 'text', value: ').' },
    ])
  })

  it('tells an unbalanced closing bracket from a balanced one', () => {
    expect(endsUnbalanced('https://example.com/a_(b)')).toBe(false)
    expect(endsUnbalanced('https://example.com/a_(b))')).toBe(true)
    expect(endsUnbalanced('https://example.com/a]')).toBe(true)
    expect(endsUnbalanced('https://example.com/a')).toBe(false)
  })

  it('never ends a link with a closing bracket it did not open', () => {
    const piece = fc.oneof(
      fc.webUrl(),
      fc.constantFrom('(', ')', '[', ']', '{', '}', '.', ',', ' ', '_', 'a'),
    )
    fc.assert(
      fc.property(fc.array(piece), (parts) => {
        const text = parts.join('')
        const segments = [...textSegments(text)]
        expect(segments.map((segment) => segment.value).join('')).toBe(text)
        for (const segment of segments)
          if (segment.type === 'link') expect(endsUnbalanced(segment.value)).toBe(false)
      }),
    )
  })

  it('never links other schemes', () => {
    const segments = [
      ...textSegments('javascript:alert(1) data:text/html,x ftp://files.test mailto:a@b.test'),
    ]
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
  })

  it('skips text that only looks like an address', () => {
    expect([...textSegments('http://')]).toEqual([{ type: 'text', value: 'http://' }])
  })

  it('preserves every character and only ever links web addresses', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.string(), fc.webUrl(), fc.constant(' '))), (parts) => {
        const text = parts.join(' ')
        const segments = [...textSegments(text)]
        expect(segments.map((segment) => segment.value).join('')).toBe(text)
        for (const segment of segments)
          if (segment.type === 'link') expect(segment.value).toMatch(/^https?:\/\//)
      }),
    )
  })
})

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
      { type: 'link', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1', kind: 'web' },
      { type: 'text', value: ' and ' },
      { type: 'link', value: 'http://x.test', href: 'http://x.test', kind: 'web' },
      { type: 'text', value: ' now' },
    ])
  })

  it('leaves trailing punctuation and a closing bracket outside the link', () => {
    expect([...textSegments('(https://example.com/docs). Done')]).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', value: 'https://example.com/docs', href: 'https://example.com/docs', kind: 'web' },
      { type: 'text', value: '). Done' },
    ])
  })

  it('keeps balanced brackets inside the link', () => {
    expect([...textSegments('https://example.com/a_(b)')]).toEqual([
      { type: 'link', value: 'https://example.com/a_(b)', href: 'https://example.com/a_(b)', kind: 'web' },
    ])
  })

  it('drops a closing bracket that closes text around a link whose own brackets balance', () => {
    expect([...textSegments('(https://en.wikipedia.org/wiki/Foo_(bar))')]).toEqual([
      { type: 'text', value: '(' },
      {
        type: 'link',
        value: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        href: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        kind: 'web',
      },
      { type: 'text', value: ')' },
    ])
  })

  it('drops an unopened closing bracket after a link that holds a balanced pair', () => {
    expect([...textSegments('see https://example.com/a_(b)_c)')]).toEqual([
      { type: 'text', value: 'see ' },
      {
        type: 'link',
        value: 'https://example.com/a_(b)_c',
        href: 'https://example.com/a_(b)_c',
        kind: 'web',
      },
      { type: 'text', value: ')' },
    ])
  })

  it('treats square brackets and braces the same way', () => {
    expect([...textSegments('[https://example.com/x_[1]] {https://example.com/y_{2}}.')]).toEqual([
      { type: 'text', value: '[' },
      { type: 'link', value: 'https://example.com/x_[1]', href: 'https://example.com/x_[1]', kind: 'web' },
      { type: 'text', value: '] {' },
      { type: 'link', value: 'https://example.com/y_{2}', href: 'https://example.com/y_{2}', kind: 'web' },
      { type: 'text', value: '}.' },
    ])
  })

  it('strips punctuation and brackets in any order', () => {
    expect([...textSegments('(see https://example.com/a).')]).toEqual([
      { type: 'text', value: '(see ' },
      { type: 'link', value: 'https://example.com/a', href: 'https://example.com/a', kind: 'web' },
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
      ...textSegments(
        'javascript:alert(1) data:text/html,x ftp://files.test ftp://me@files.test mailto:a@b.test',
      ),
    ]
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
  })

  it('opens an address that starts with www. over https', () => {
    expect([...textSegments('See www.example.com/a, or WWW.x.test.')]).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'link', value: 'www.example.com/a', href: 'https://www.example.com/a', kind: 'web' },
      { type: 'text', value: ', or ' },
      { type: 'link', value: 'WWW.x.test', href: 'https://WWW.x.test', kind: 'web' },
      { type: 'text', value: '.' },
    ])
  })

  it('leaves www. text that names no host, and www. inside another word or address', () => {
    for (const text of ['go to www. now', 'www.example', 'awww.example.com', 'me@www.example.com'])
      expect(
        [...textSegments(text)].filter((segment) => segment.type === 'link' && segment.kind === 'web'),
      ).toEqual([])
    expect([...textSegments('https://www.example.com')]).toEqual([
      { type: 'link', value: 'https://www.example.com', href: 'https://www.example.com', kind: 'web' },
    ])
  })

  it('opens a mail address with mailto, outside a web address', () => {
    expect([...textSegments('Write to ana.silva+hb@mail.example.org. Thanks')]).toEqual([
      { type: 'text', value: 'Write to ' },
      {
        type: 'link',
        value: 'ana.silva+hb@mail.example.org',
        href: 'mailto:ana.silva+hb@mail.example.org',
        kind: 'mail',
      },
      { type: 'text', value: '. Thanks' },
    ])
    expect([...textSegments('https://x.test/a@b.test')]).toEqual([
      { type: 'link', value: 'https://x.test/a@b.test', href: 'https://x.test/a@b.test', kind: 'web' },
    ])
    expect([...textSegments('a@b and @handle')]).toEqual([{ type: 'text', value: 'a@b and @handle' }])
  })

  it('skips a www. address the platform cannot parse', () => {
    expect([...textSegments('www.example.com:99999')]).toEqual([
      { type: 'text', value: 'www.example.com:99999' },
    ])
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
          if (segment.type === 'link') expect(segment.href).toMatch(/^(https?:\/\/|mailto:)/)
      }),
    )
  })
})

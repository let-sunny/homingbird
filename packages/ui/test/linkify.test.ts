import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type TextSegment, endsUnbalanced, textSegments } from '../src/linkify.ts'

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

  it('never links other schemes, nor an address a scheme or a path runs into', () => {
    const segments = [
      ...textSegments(
        'javascript:alert(1) data:text/html,x ftp://files.test ftp://me@files.test mailto:a@b.test ' +
          'javascript:www.x.test data:ana@x.test x.test/www.y.test',
      ),
    ]
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
  })

  it('skips text that only looks like an address', () => {
    expect([...textSegments('http://')]).toEqual([{ type: 'text', value: 'http://' }])
    expect([...textSegments('http://[::1')]).toEqual([{ type: 'text', value: 'http://[::1' }])
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

  it('skips a www. address the platform cannot parse', () => {
    expect([...textSegments('www.example.com:99999')]).toEqual([
      { type: 'text', value: 'www.example.com:99999' },
    ])
  })

  it('opens a mail address with mailto, but not one inside a web address', () => {
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

  it('links nothing but http, https, www. and mail addresses', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.string(), fc.webUrl(), address, fc.constant(' '))), (parts) => {
        for (const segment of textSegments(parts.join(' '))) {
          if (segment.type === 'text') continue
          expect(isAllowedLink(segment)).toBe(true)
          expect(ALLOWED_PROTOCOLS).toContain(new URL(segment.href).protocol)
        }
      }),
    )
  })

  it('never links a javascript: or data: address', () => {
    const scheme = fc.constantFrom('javascript:', 'JavaScript:', 'data:', 'DATA:', ' javascript:', 'data:,')
    const rest = fc.oneof(
      fc.string(),
      address,
      fc.webUrl(),
      fc.constantFrom('alert(1)', 'text/html,<b>x</b>'),
    )
    fc.assert(
      fc.property(scheme, rest, (prefix, tail) => {
        const text = `${prefix}${tail}`
        let start = 0
        for (const segment of textSegments(text)) {
          if (segment.type === 'link') {
            expect(start).toBeGreaterThanOrEqual(prefix.length)
            expect(segment.href).not.toMatch(/^\s*(javascript|data):/iu)
          }
          start += segment.value.length
        }
      }),
    )
  })

  it('keeps the text around a link as it was', () => {
    fc.assert(
      fc.property(prose, address, prose, (before, link, after) => {
        const text = `${before} ${link} ${after}`
        expect([...textSegments(text)].map(({ type, value }) => ({ type, value }))).toEqual([
          { type: 'text', value: `${before} ` },
          { type: 'link', value: link },
          { type: 'text', value: ` ${after}` },
        ])
      }),
    )
  })

  it('preserves every character of any text', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.string(), fc.webUrl(), address, fc.constant(' '))), (parts) => {
        const text = parts.join(' ')
        expect([...textSegments(text)].map((segment) => segment.value).join('')).toBe(text)
      }),
    )
  })

  it('leaves trailing punctuation outside the link', () => {
    const punctuation = fc
      .array(fc.constantFrom('.', ',', ';', ':', '!', '?', ')', ']', '}'), { minLength: 1, maxLength: 4 })
      .map((marks) => marks.join(''))
    fc.assert(
      fc.property(address, punctuation, (link, marks) => {
        const segments = [...textSegments(`${link}${marks} next`)]
        expect(segments[0]?.value).toBe(link)
        expect(segments[1]).toEqual({ type: 'text', value: `${marks} next` })
      }),
    )
  })
})

const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:']

const isAllowedLink = (segment: TextSegment & { readonly type: 'link' }): boolean =>
  segment.kind === 'mail'
    ? segment.href === `mailto:${segment.value}` && /^[\w.%+-]+@[a-z\d.-]+\.[a-z]{2,}$/iu.test(segment.value)
    : /^https?:\/\//iu.test(segment.value)
      ? segment.href === segment.value
      : segment.href === `https://${segment.value}` && /^www\./iu.test(segment.value)

const word = fc.stringMatching(/^[a-z\d]{1,8}$/)

const host = fc.array(word, { minLength: 1, maxLength: 3 }).map((labels) => labels.join('.'))

const topLevel = fc.stringMatching(/^[a-z]{2,6}$/)

const path = fc.array(word, { maxLength: 3 }).map((segments) => segments.map((part) => `/${part}`).join(''))

const address = fc.oneof(
  fc
    .tuple(fc.constantFrom('http', 'https'), host, topLevel, path)
    .map(([scheme, name, tld, rest]) => `${scheme}://${name}.${tld}${rest}`),
  fc.tuple(host, topLevel, path).map(([name, tld, rest]) => `www.${name}.${tld}${rest}`),
  fc.tuple(word, host, topLevel).map(([local, name, tld]) => `${local}@${name}.${tld}`),
)

const prose = fc.array(fc.stringMatching(/^[a-z,]{0,8}$/), { maxLength: 6 }).map((words) => words.join(' '))

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { codeSpans } from '../src/code-spans.ts'

describe('codeSpans', () => {
  it('returns text without backticks as one span, and nothing for an empty text', () => {
    expect([...codeSpans('no code here')]).toEqual([{ type: 'text', value: 'no code here' }])
    expect([...codeSpans('')]).toEqual([])
  })

  it('cuts out inline code between runs of the same length', () => {
    expect([...codeSpans('Run `pnpm test` then ``a ` b`` now')]).toEqual([
      { type: 'text', value: 'Run ' },
      { type: 'code', value: 'pnpm test' },
      { type: 'text', value: ' then ' },
      { type: 'code', value: 'a ` b' },
      { type: 'text', value: ' now' },
    ])
  })

  it('drops one space of padding on each side, so code may start with a backtick, but keeps only spaces', () => {
    expect([...codeSpans('`` `x` ``')]).toEqual([{ type: 'code', value: '`x`' }])
    expect([...codeSpans('`  `')]).toEqual([{ type: 'code', value: '  ' }])
    expect([...codeSpans('` a`')]).toEqual([{ type: 'code', value: ' a' }])
  })

  it('leaves an unmatched backtick and code across lines as text', () => {
    expect([...codeSpans('it`s fine')]).toEqual([{ type: 'text', value: 'it`s fine' }])
    expect([...codeSpans('`one\ntwo`')]).toEqual([{ type: 'text', value: '`one\ntwo`' }])
    expect([...codeSpans('``x`')]).toEqual([{ type: 'text', value: '``x`' }])
  })

  it('reads a fenced block with its language, and the prose around it without the line breaks', () => {
    expect([...codeSpans('Try this:\n```sql\nSELECT 1;\n  -- kept\n```\nThen `commit`.')]).toEqual([
      { type: 'text', value: 'Try this:' },
      { type: 'block', value: 'SELECT 1;\n  -- kept', language: 'sql' },
      { type: 'text', value: 'Then ' },
      { type: 'code', value: 'commit' },
      { type: 'text', value: '.' },
    ])
  })

  it('closes a fence only with a line of at least as many backticks, and indented up to three spaces', () => {
    expect([...codeSpans('````\n```\ninner\n```\n   ````  ')]).toEqual([
      { type: 'block', value: '```\ninner\n```', language: null },
    ])
    expect([...codeSpans('    ```\nx\n```')]).toEqual([{ type: 'text', value: '    ```\nx\n```' }])
  })

  it('keeps an unclosed fence as text, and a fence whose info has a backtick is no fence', () => {
    expect([...codeSpans('```\nno end')]).toEqual([{ type: 'text', value: '```\nno end' }])
    expect([...codeSpans('``` a`b\nx\n```')]).toEqual([{ type: 'text', value: '``` a`b\nx\n```' }])
  })

  it('reads an empty block, and two blocks in a row', () => {
    expect([...codeSpans('```\n```\n```js\nx\n```')]).toEqual([
      { type: 'block', value: '', language: null },
      { type: 'block', value: 'x', language: 'js' },
    ])
  })

  it('keeps every character of a text without fences, in order', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('a', ' ', '\n', '`', 'b') }), (text) => {
        fc.pre(!text.split('\n').some((line) => /^ {0,3}```/.test(line)))
        const spans = [...codeSpans(text)]
        const joined = spans.map((span) => span.value).join('')
        expect(joined.replaceAll('`', '').replaceAll(' ', '')).toBe(
          text.replaceAll('`', '').replaceAll(' ', ''),
        )
      }),
    )
  })
})

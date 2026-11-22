/**
 * A note's text cut into prose, inline code and fenced code blocks, the only Markdown a note is shown
 * with. A fence is a line of three or more backticks, closed by a line of at least as many; an
 * unclosed fence is prose. Inline code is a run of backticks closed by a run of the same length on the
 * same line.
 */
export function* codeSpans(text: string): Generator<CodeSpan, void> {
  const lines = text.split('\n')
  let prose: string[] = []
  let at = 0
  while (at < lines.length) {
    const opening = OPENING_FENCE.exec(lines[at]!)
    const end = opening === null ? -1 : closingLine(lines, at, opening[1]!.length)
    if (opening === null || end === -1) {
      prose.push(lines[at]!)
      at += 1
      continue
    }
    if (prose.length > 0) yield* inlineSpans(prose.join('\n'))
    prose = []
    const language = opening[2]!.trim()
    yield { type: 'block', value: lines.slice(at + 1, end).join('\n'), language: language || null }
    at = end + 1
  }
  if (prose.length > 0) yield* inlineSpans(prose.join('\n'))
}

export type CodeSpan =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'block'; readonly value: string; readonly language: string | null }

function* inlineSpans(text: string): Generator<CodeSpan, void> {
  let cursor = 0
  for (const match of text.matchAll(INLINE_CODE)) {
    if (match.index > cursor) yield { type: 'text', value: text.slice(cursor, match.index) }
    yield { type: 'code', value: withoutPadding(match[2]!) }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) yield { type: 'text', value: text.slice(cursor) }
}

const closingLine = (lines: ReadonlyArray<string>, opening: number, length: number): number =>
  lines.findIndex((line, at) => {
    const closing = at > opening ? CLOSING_FENCE.exec(line) : null
    return closing !== null && closing[1]!.length >= length
  })

/** One space on each side is padding, so that code may start or end with a backtick. */
const withoutPadding = (code: string): string =>
  code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== ''
    ? code.slice(1, -1)
    : code

const OPENING_FENCE = /^ {0,3}(`{3,})([^`]*)$/
const CLOSING_FENCE = /^ {0,3}(`{3,})[ \t]*$/
const INLINE_CODE = /(?<!`)(`+)(?!`)([^\n]*?[^`\n])\1(?!`)/g

export type TextSegment =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'link'; readonly value: string }

export function* textSegments(text: string): Generator<TextSegment, void> {
  let cursor = 0
  for (const match of text.matchAll(WEB_ADDRESS)) {
    const address = withoutTrailingPunctuation(match[0])
    if (!URL.canParse(address)) continue
    if (match.index > cursor) yield { type: 'text', value: text.slice(cursor, match.index) }
    yield { type: 'link', value: address }
    cursor = match.index + address.length
  }
  if (cursor < text.length) yield { type: 'text', value: text.slice(cursor) }
}

export const endsUnbalanced = (address: string): boolean =>
  BRACKETS.some(([open, close]) => address.endsWith(close) && count(address, close) > count(address, open))

const WEB_ADDRESS = /https?:\/\/[^\s<>"'`]+/g

const TRAILING_PUNCTUATION = /[.,;:!?]+$/

const BRACKETS: ReadonlyArray<readonly [string, string]> = [
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]

const withoutTrailingPunctuation = (address: string): string => {
  let trimmed = address
  for (;;) {
    const next = trimmed.replace(TRAILING_PUNCTUATION, '')
    const shorter = endsUnbalanced(next) ? next.slice(0, -1) : next
    if (shorter === trimmed) return trimmed
    trimmed = shorter
  }
}

const count = (text: string, character: string): number => text.split(character).length - 1

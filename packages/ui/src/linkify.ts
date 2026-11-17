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

const WEB_ADDRESS = /https?:\/\/[^\s<>"'`]+/g

const withoutTrailingPunctuation = (address: string): string => {
  const trimmed = address.replace(/[.,;:!?]+$/, '')
  return trimmed.endsWith(')') && !trimmed.includes('(') ? trimmed.slice(0, -1) : trimmed
}

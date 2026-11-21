export type TextSegment =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'link'; readonly value: string; readonly href: string; readonly kind: LinkKind }

export type LinkKind = 'web' | 'mail'

/**
 * Text cut into plain runs and the addresses in it: web addresses with `http:` or `https:`, ones that
 * start with `www.` (opened with `https:`), and mail addresses (opened with `mailto:`). No other scheme
 * becomes a link.
 */
export function* textSegments(text: string): Generator<TextSegment, void> {
  let cursor = 0
  for (const match of text.matchAll(ADDRESS)) {
    const address = withoutTrailingPunctuation(match[0])
    const link = linkOf(address, match.groups?.mail === undefined ? 'web' : 'mail')
    if (link === null) continue
    if (match.index > cursor) yield { type: 'text', value: text.slice(cursor, match.index) }
    yield { type: 'link', value: address, ...link }
    cursor = match.index + address.length
  }
  if (cursor < text.length) yield { type: 'text', value: text.slice(cursor) }
}

export const endsUnbalanced = (address: string): boolean =>
  BRACKETS.some(([open, close]) => address.endsWith(close) && count(address, close) > count(address, open))

const ADDRESS = new RegExp(
  [
    /https?:\/\/[^\s<>"'`]+/.source,
    /(?<![\w@./:-])www\.[^\s<>"'`]+/.source,
    /(?<mail>(?<![\w.%+/:-])[\w.%+-]+@[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,}(?![\w@-]))/.source,
  ].join('|'),
  'giu',
)

const linkOf = (
  address: string,
  kind: LinkKind,
): { readonly href: string; readonly kind: LinkKind } | null => {
  if (kind === 'mail') return { href: `mailto:${address}`, kind }
  const href = /^https?:\/\//iu.test(address) ? address : `https://${address}`
  if (href !== address && !WWW_HOST.test(address)) return null
  return URL.canParse(href) ? { href, kind } : null
}

/** `www.` followed by at least a name and a dot, so that a sentence ending in "www." stays text. */
const WWW_HOST = /^www\.[\w-]+\./iu

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

import type { AsRead, MemberId } from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { conversationTitle, excerpt } from '../thread.ts'
import { type TimeShown, timeShown } from './time.ts'

/** Search: a prompt before the first search, then what was found, newest as the server ordered it. */
export const searchModel = (input: SearchInput): SearchModel => {
  const found = input.results
  if (found === null) return { kind: 'prompt', text: strings.searchPrompt }
  if (found === 'searching') return { kind: 'searching' }
  if (found.length === 0) return { kind: 'empty', text: strings.searchEmpty }
  return { kind: 'results', rows: found.map((note) => resultRow(input, note)) }
}

export interface SearchInput {
  readonly results: ReadonlyArray<AsRead.Note> | 'searching' | null
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly viewerId: MemberId
  readonly now: number
  /** What was searched for, marked wherever an excerpt contains it. */
  readonly query: string
}

export type SearchModel =
  | { readonly kind: 'prompt'; readonly text: string }
  | { readonly kind: 'searching' }
  | { readonly kind: 'empty'; readonly text: string }
  | { readonly kind: 'results'; readonly rows: ReadonlyArray<SearchRow> }

export interface SearchRow {
  readonly href: string
  readonly author: string
  readonly title: string | null
  readonly time: TimeShown
  readonly excerpt: ReadonlyArray<ExcerptPart>
}

export interface ExcerptPart {
  readonly text: string
  readonly isMatch: boolean
}

const resultRow = (input: SearchInput, note: AsRead.Note): SearchRow => {
  const conversation = input.conversations.find((candidate) => candidate.id === note.conversationId)
  const title =
    conversation === undefined
      ? ''
      : conversationTitle(conversation, input.members, input.viewerId, strings.formerMember)
  const author = input.members.get(note.authorId)?.name ?? strings.formerMember
  return {
    href: hrefFor({ name: 'conversation', id: note.conversationId, draft: null }),
    author,
    title: title === '' || title === author ? null : title,
    time: timeShown(note.sentAt ?? note.createdAt, input.now),
    excerpt: matchedParts(excerpt(note.body, 240), input.query.trim()),
  }
}

/** The text cut where it contains the needle, ignoring case, as the server matched it. */
const matchedParts = (text: string, needle: string): ReadonlyArray<ExcerptPart> => {
  if (needle === '') return [{ text, isMatch: false }]
  const pattern = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'giu')
  return text
    .split(pattern)
    .map((part, index) => ({ text: part, isMatch: index % 2 === 1 }))
    .filter((part) => part.text !== '')
}

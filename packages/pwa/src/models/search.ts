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
  readonly excerpt: string
}

const resultRow = (input: SearchInput, note: AsRead.Note): SearchRow => {
  const conversation = input.conversations.find((candidate) => candidate.id === note.conversationId)
  const title =
    conversation === undefined
      ? ''
      : conversationTitle(conversation, input.members, input.viewerId, strings.formerMember)
  return {
    href: hrefFor({ name: 'conversation', id: note.conversationId }),
    author: input.members.get(note.authorId)?.name ?? strings.formerMember,
    title: title === '' ? null : title,
    time: timeShown(note.sentAt ?? note.createdAt, input.now),
    excerpt: excerpt(note.body, 240),
  }
}

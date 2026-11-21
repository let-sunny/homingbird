import { APPLIED_PREFIX, type AsRead } from '@homingbird/protocol'
import { hrefFor } from './routes.ts'
import { strings } from './strings.ts'

export type DraftBasis =
  | {
      readonly kind: 'given'
      readonly lines: ReadonlyArray<string>
      readonly sources: ReadonlyArray<SourceShown>
    }
  | { readonly kind: 'none' }

/**
 * One thing a draft rests on, as its reader sees it: a link to a web page, a jump to an earlier note, or,
 * for anything the page cannot open, its words; with the passage the agent used, if it gave one.
 */
export interface SourceShown {
  readonly kind: 'link' | 'note' | 'text'
  readonly label: string
  readonly href: string | null
  readonly quote: string | null
}

/**
 * What a note was based on, for its author; null when the server did not share it. `leavingOutApplied`
 * drops the "Principles applied:" line where the card names those principles in the reader's language.
 */
export const draftBasisOf = (note: AsRead.Note, leavingOutApplied = false): DraftBasis | null => {
  if (note.basis === undefined) return null
  const given = linesOf(note.basis ?? '')
  const lines = leavingOutApplied ? given.map(withoutAppliedClaim).filter((line) => line !== '') : given
  const sources = sourcesOf(note)
  if (lines.length > 0 || sources.length > 0) return { kind: 'given', lines, sources }
  return given.length === 0 ? { kind: 'none' } : null
}

/** A note's sources as links and jumps; one the client could not read is left out. */
export const sourcesOf = (note: Pick<AsRead.Note, 'sources'>): ReadonlyArray<SourceShown> =>
  (note.sources ?? []).flatMap((source) => (source === null ? [] : [sourceShown(source)]))

const sourceShown = (source: NonNullable<NonNullable<AsRead.Note['sources']>[number]>): SourceShown => {
  const quote = source.quote?.trim() || null
  if (source.url !== undefined)
    return isWebAddress(source.url)
      ? { kind: 'link', label: source.url, href: source.url, quote }
      : { kind: 'text', label: source.url, href: null, quote }
  if (source.noteId !== undefined && source.conversationId !== undefined)
    return {
      kind: 'note',
      label: strings.sourceNote,
      href: hrefFor({ name: 'conversation', id: source.conversationId, draft: null, note: source.noteId }),
      quote,
    }
  return { kind: 'text', label: strings.sourceNoteUnknown, href: null, quote }
}

const isWebAddress = (text: string): boolean => /^https?:\/\/[^\s/]+(\/\S*)?$/i.test(text)

const linesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const withoutAppliedClaim = (line: string): string => {
  const start = line.toLowerCase().indexOf(APPLIED_PREFIX.toLowerCase())
  return start === -1 ? line : line.slice(0, start).trim()
}

import { APPLIED_PREFIX, type AsRead } from '@homingbird/protocol'

export type DraftBasis =
  | { readonly kind: 'given'; readonly lines: ReadonlyArray<string> }
  | { readonly kind: 'none' }

/**
 * What a note was based on, for its author; null when the server did not share it. `leavingOutApplied`
 * drops the "Principles applied:" line where the card names those principles in the reader's language.
 */
export const draftBasisOf = (note: AsRead.Note, leavingOutApplied = false): DraftBasis | null => {
  if (note.basis === undefined) return null
  const given = linesOf(note.basis ?? '')
  const lines = leavingOutApplied ? given.map(withoutAppliedClaim).filter((line) => line !== '') : given
  if (lines.length > 0) return { kind: 'given', lines }
  return given.length === 0 ? { kind: 'none' } : null
}

const linesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const withoutAppliedClaim = (line: string): string => {
  const start = line.toLowerCase().indexOf(APPLIED_PREFIX.toLowerCase())
  return start === -1 ? line : line.slice(0, start).trim()
}

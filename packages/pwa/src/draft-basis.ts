import type { Note } from '@homingbird/protocol'

export type DraftBasis =
  | { readonly kind: 'given'; readonly lines: ReadonlyArray<string> }
  | { readonly kind: 'none' }

/** What a note was based on, for its author; null when the server did not share it with this viewer. */
export const draftBasisOf = (note: Note): DraftBasis | null => {
  if (note.basis === undefined) return null
  const lines = (note.basis ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.length === 0 ? { kind: 'none' } : { kind: 'given', lines }
}

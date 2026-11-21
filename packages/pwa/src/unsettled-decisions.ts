import type { MemberId, NoteId } from '@homingbird/protocol'
import type { PageStorage } from './browser-page.ts'
import type { HeldDecision } from './state.ts'

/**
 * The decisions this browser held for a person and never saw carried out, as when the page died within
 * the moment to undo; nothing when none was kept or what was kept is unreadable.
 */
export const keptUnsettled = (storage: PageStorage, memberId: MemberId): ReadonlyArray<Unsettled> => {
  const stored = storage.local(storageKeyFor(memberId))
  if (stored === null) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.filter(isUnsettled) : []
  } catch {
    return []
  }
}

/** Keeps a decision in this browser until it is carried out, undone or refused. */
export const keepUnsettled = (storage: PageStorage, memberId: MemberId, decision: HeldDecision): void =>
  write(storage, memberId, [
    ...keptUnsettled(storage, memberId).filter((kept) => kept.noteId !== decision.noteId),
    {
      noteId: decision.noteId,
      kind: decision.kind,
      review: decision.review,
      notDone: decision.words.notDone,
    },
  ])

/** Forgets one decision this browser kept, once the server answered or the person undid it. */
export const forgetUnsettled = (storage: PageStorage, memberId: MemberId, noteId: NoteId): void =>
  write(
    storage,
    memberId,
    keptUnsettled(storage, memberId).filter((kept) => kept.noteId !== noteId),
  )

export interface Unsettled {
  readonly noteId: NoteId
  readonly kind: 'send' | 'discard'
  readonly review: boolean
  /** What to tell the person when the draft or answer still waits, in the words of the page that held it. */
  readonly notDone: string
}

const write = (storage: PageStorage, memberId: MemberId, kept: ReadonlyArray<Unsettled>): void => {
  if (kept.length === 0) storage.removeLocal(storageKeyFor(memberId))
  else storage.setLocal(storageKeyFor(memberId), JSON.stringify(kept))
}

const isUnsettled = (value: unknown): value is Unsettled =>
  typeof value === 'object' &&
  value !== null &&
  'noteId' in value &&
  typeof value.noteId === 'string' &&
  'kind' in value &&
  (value.kind === 'send' || value.kind === 'discard') &&
  'review' in value &&
  typeof value.review === 'boolean' &&
  'notDone' in value &&
  typeof value.notDone === 'string'

const storageKeyFor = (memberId: MemberId): string => `${STORAGE_PREFIX}${memberId}`

const STORAGE_PREFIX = 'homingbird.unsettled.'

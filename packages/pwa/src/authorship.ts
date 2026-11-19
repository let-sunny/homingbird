import { type Note, type Receipt, summarize } from '@homingbird/protocol'
import { type SingleStatus, readProgress, statusOf } from './thread.ts'

export type Authorship = 'agent' | 'edited' | 'person'

/** How a note was written: by the author's agent, by their agent and edited by them, or by them. */
export const authorshipOf = (note: Pick<Note, 'origin'>): Authorship =>
  note.origin === 'agent' ? 'agent' : note.origin === 'human_edited' ? 'edited' : 'person'

export interface StateMark {
  readonly state: SingleStatus
  readonly count: { readonly read: number; readonly of: number } | null
}

/** The delivery state of one of my notes as a mark, with a compact count only when more than one person gets it. */
export const stateMarkOf = (receipts: ReadonlyArray<Receipt>): StateMark => {
  const state = statusOf(summarize(receipts))
  const { read, of } = readProgress(receipts)
  return { state, count: of > 1 ? { read, of } : null }
}

/** A run shows its state once, on its last note, and again on an earlier note only where the state differs. */
export const showsStateMark = (note: Pick<Note, 'receipts'>, next: Pick<Note, 'receipts'> | null): boolean =>
  next === null || !sameMark(stateMarkOf(note.receipts), stateMarkOf(next.receipts))

/** Cuts a label to fit on one line; the full text stays in the accessible description. */
export const shortLabel = (label: string, max = LABEL_SHOWN): string =>
  label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`

export const LABEL_SHOWN = 32

const sameMark = (a: StateMark, b: StateMark): boolean =>
  a.state === b.state && a.count?.read === b.count?.read && a.count?.of === b.count?.of

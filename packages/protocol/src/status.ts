/**
 * Note and receipt state, as pure functions. The server stores timestamps; every client derives
 * the same state from them, which is what makes status identical for all participants.
 */
import { Result, tagged } from '@homingbird/kernel'
import type { NoteStatus, Receipt, ReceiptState } from './model.ts'

export const IllegalTransition = tagged('IllegalTransition')<{ readonly from: NoteStatus; readonly to: NoteStatus }>()
export type IllegalTransition = ReturnType<typeof IllegalTransition>

/** `draft -> sent` and `draft -> discarded` are the only moves. Sent and discarded are final. */
export const NOTE_TRANSITIONS: Readonly<Record<NoteStatus, ReadonlyArray<NoteStatus>>> = {
  draft: ['sent', 'discarded'],
  sent: [],
  discarded: [],
}

export const transition = (from: NoteStatus, to: NoteStatus): Result.Result<NoteStatus, IllegalTransition> =>
  NOTE_TRANSITIONS[from].includes(to) ? Result.ok(to) : Result.err(IllegalTransition({ from, to }))

export interface ReceiptTimes {
  readonly readAt: number | null
  readonly draftingAt: number | null
  readonly repliedAt: number | null
}

/** The furthest stage a recipient has reached: `delivered -> read -> drafting -> replied`. */
export const receiptState = (times: ReceiptTimes): ReceiptState =>
  times.repliedAt !== null
    ? 'replied'
    : times.draftingAt !== null
      ? 'drafting'
      : times.readAt !== null
        ? 'read'
        : 'delivered'

export const RECEIPT_ORDER: ReadonlyArray<ReceiptState> = ['delivered', 'read', 'drafting', 'replied']

export interface StatusSummary {
  readonly recipients: number
  /** Recipients whose human has opened the note. */
  readonly read: number
  /** Recipients with a reply draft in progress and no reply sent yet. */
  readonly drafting: number
  readonly replied: number
}

/** Counts behind lines such as "read by 2 of 3". */
export const summarize = (receipts: ReadonlyArray<Receipt>): StatusSummary => ({
  recipients: receipts.length,
  read: receipts.filter((r) => r.readAt !== null).length,
  drafting: receipts.filter((r) => r.state === 'drafting').length,
  replied: receipts.filter((r) => r.repliedAt !== null).length,
})

/** The one-line status every participant sees for a sent note. */
export const describeStatus = (summary: StatusSummary): string => {
  const { recipients, read, drafting, replied } = summary
  if (recipients === 0) return 'Sent'
  if (recipients === 1)
    return replied === 1 ? 'Replied' : drafting === 1 ? 'Drafting reply' : read === 1 ? 'Read' : 'Delivered'
  const parts = [
    replied > 0 ? `replied by ${replied} of ${recipients}` : null,
    drafting > 0 ? `${drafting} drafting` : null,
    replied < recipients ? `read by ${read} of ${recipients}` : null,
  ].filter((p): p is string => p !== null)
  return parts.join(', ').replace(/^./, (c) => c.toUpperCase())
}

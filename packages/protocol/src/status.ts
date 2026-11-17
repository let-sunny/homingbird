import { Result, tagged } from '@homingbird/kernel'
import type { NoteStatus, Receipt, ReceiptState } from './model.ts'

export const IllegalTransition = tagged('IllegalTransition')<{
  readonly from: NoteStatus
  readonly to: NoteStatus
}>()
export type IllegalTransition = ReturnType<typeof IllegalTransition>

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
  readonly read: number
  readonly drafting: number
  readonly replied: number
}

export const summarize = (receipts: ReadonlyArray<Receipt>): StatusSummary => ({
  recipients: receipts.length,
  read: receipts.filter((r) => r.readAt !== null).length,
  drafting: receipts.filter((r) => r.state === 'drafting').length,
  replied: receipts.filter((r) => r.repliedAt !== null).length,
})

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

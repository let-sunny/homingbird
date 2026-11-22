import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { NoteStatus, Receipt, ReceiptState } from '../src/model.ts'
import {
  IllegalTransition,
  NOTE_TRANSITIONS,
  RECEIPT_ORDER,
  describeStatus,
  receiptState,
  summarize,
  transition,
} from '../src/status.ts'

const statuses: NoteStatus[] = ['draft', 'sent', 'discarded', 'withdrawn']
const time = fc.option(fc.nat(), { nil: null })
const times = fc.record({ readAt: time, draftingAt: time, repliedAt: time })

const receipt = (state: ReceiptState, over: Partial<Receipt> = {}): Receipt =>
  ({
    memberId: 'mem_aaaaaaaaaaaa',
    state,
    deliveredAt: 1,
    readAt: null,
    draftingAt: null,
    repliedAt: null,
    ...over,
  }) as Receipt

describe('note transitions', () => {
  it('allows exactly draft to sent, draft to discarded and sent to withdrawn', () => {
    const allowed = statuses.flatMap((from) =>
      statuses.filter((to) => transition(from, to)._tag === 'Ok').map((to) => [from, to]),
    )
    expect(allowed).toEqual([
      ['draft', 'sent'],
      ['draft', 'discarded'],
      ['sent', 'withdrawn'],
    ])
  })

  it('reports the refused move', () => {
    expect(transition('sent', 'draft')).toMatchObject({
      _tag: 'Err',
      error: IllegalTransition({ from: 'sent', to: 'draft' }),
    })
    expect(transition('draft', 'sent')).toMatchObject({ _tag: 'Ok', value: 'sent' })
  })

  it('leaves draft once, lets a sent note only be withdrawn, and makes discarded and withdrawn final, whatever sequence of moves is tried', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...statuses), { maxLength: 8 }), (moves) => {
        const path: NoteStatus[] = ['draft']
        for (const move of moves) {
          const next = transition(path.at(-1)!, move)
          if (next._tag === 'Ok') path.push(next.value)
        }
        expect(path.filter((status) => status === 'draft')).toHaveLength(1)
        expect(path.slice(1, 2).every((status) => status === 'sent' || status === 'discarded')).toBe(true)
        expect(path.slice(2).every((status) => status === 'withdrawn')).toBe(true)
        expect(path.length).toBeLessThanOrEqual(3)
        const last = path.at(-1)!
        expect(NOTE_TRANSITIONS[last].length === 0).toBe(last === 'discarded' || last === 'withdrawn')
      }),
    )
  })
})

describe('receiptState', () => {
  it.each([
    [{ readAt: null, draftingAt: null, repliedAt: null }, 'delivered'],
    [{ readAt: 1, draftingAt: null, repliedAt: null }, 'read'],
    [{ readAt: null, draftingAt: 1, repliedAt: null }, 'drafting'],
    [{ readAt: 1, draftingAt: 2, repliedAt: null }, 'drafting'],
    [{ readAt: null, draftingAt: null, repliedAt: 3 }, 'replied'],
    [{ readAt: 1, draftingAt: 2, repliedAt: 3 }, 'replied'],
  ] as const)('derives %j as %s', (input, expected) => {
    expect(receiptState(input)).toBe(expected)
  })

  it('never moves backwards when a timestamp is added', () => {
    fc.assert(
      fc.property(
        times,
        fc.constantFrom('readAt', 'draftingAt', 'repliedAt'),
        fc.nat(),
        (before, field, at) => {
          const after = { ...before, [field]: before[field as keyof typeof before] ?? at }
          expect(RECEIPT_ORDER.indexOf(receiptState(after))).toBeGreaterThanOrEqual(
            RECEIPT_ORDER.indexOf(receiptState(before)),
          )
        },
      ),
    )
  })

  it('orders the stages as delivered, read, drafting, replied', () => {
    expect(RECEIPT_ORDER).toEqual(['delivered', 'read', 'drafting', 'replied'])
  })
})

describe('summarize and describeStatus', () => {
  it('counts readers, drafters and repliers', () => {
    const receipts = [
      receipt('delivered'),
      receipt('read', { readAt: 5 }),
      receipt('drafting', { draftingAt: 6 }),
      receipt('replied', { readAt: 5, repliedAt: 7 }),
    ]
    expect(summarize(receipts)).toEqual({ recipients: 4, read: 2, drafting: 1, replied: 1 })
  })

  it('keeps every count within the number of recipients', () => {
    const anyReceipt = times.map((t) => receipt(receiptState(t), t))
    fc.assert(
      fc.property(fc.array(anyReceipt, { maxLength: 12 }), (receipts) => {
        const summary = summarize(receipts)
        expect(summary.recipients).toBe(receipts.length)
        for (const count of [summary.read, summary.drafting, summary.replied]) {
          expect(count).toBeGreaterThanOrEqual(0)
          expect(count).toBeLessThanOrEqual(receipts.length)
        }
        expect(summary.drafting + summary.replied).toBeLessThanOrEqual(receipts.length)
        expect(describeStatus(summary)).toMatch(/^[A-Z0-9]/)
      }),
    )
  })

  it.each([
    [{ recipients: 0, read: 0, drafting: 0, replied: 0 }, 'Sent'],
    [{ recipients: 1, read: 0, drafting: 0, replied: 0 }, 'Delivered'],
    [{ recipients: 1, read: 1, drafting: 0, replied: 0 }, 'Read'],
    [{ recipients: 1, read: 0, drafting: 1, replied: 0 }, 'Drafting reply'],
    [{ recipients: 1, read: 1, drafting: 0, replied: 1 }, 'Replied'],
    [{ recipients: 3, read: 0, drafting: 0, replied: 0 }, 'Read by 0 of 3'],
    [{ recipients: 3, read: 2, drafting: 0, replied: 0 }, 'Read by 2 of 3'],
    [{ recipients: 3, read: 2, drafting: 1, replied: 0 }, '1 drafting, read by 2 of 3'],
    [{ recipients: 3, read: 3, drafting: 1, replied: 1 }, 'Replied by 1 of 3, 1 drafting, read by 3 of 3'],
    [{ recipients: 3, read: 3, drafting: 0, replied: 3 }, 'Replied by 3 of 3'],
  ])('describes %j as "%s"', (summary, expected) => {
    expect(describeStatus(summary)).toBe(expected)
  })
})

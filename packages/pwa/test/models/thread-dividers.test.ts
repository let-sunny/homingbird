import type { AsRead, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { firstUnreadIn, withDividers } from '../../src/models/thread-dividers.ts'
import { dayHeading } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, note } from '../support/fixtures.ts'

const NOW = new Date(2026, 10, 19, 15).getTime()
const DAY = 86_400_000

const noteItem = (id: string, sentAt: number) => ({ type: 'note', key: id, note: note(id, { sentAt }) })
const unread = (id: string, fields: Partial<AsRead.Note> = {}): AsRead.Note =>
  note(id, {
    receipts: [
      { memberId: ANA, state: 'delivered', deliveredAt: 1, readAt: null, draftingAt: null, repliedAt: null },
    ],
    ...fields,
  })

describe('withDividers', () => {
  it('heads each day where it changes, and the first note only when it is not from today', () => {
    const shown = withDividers(
      [
        noteItem('a', NOW - 2 * DAY),
        noteItem('b', NOW - 2 * DAY + 60_000),
        { type: 'drafts', key: 'drafts:x' },
        noteItem('c', NOW - 60_000),
      ],
      { now: NOW, unreadFrom: null },
    )
    expect(shown.map((item) => item.key)).toEqual([
      `day:${new Date(NOW - 2 * DAY).toDateString()}`,
      'a',
      'b',
      'drafts:x',
      `day:${new Date(NOW).toDateString()}`,
      'c',
    ])
    expect(shown[0]).toMatchObject({ type: 'divider', kind: 'day', text: dayHeading(NOW - 2 * DAY, NOW) })
    expect(shown[4]).toMatchObject({ text: strings.today })
    expect(withDividers([noteItem('a', NOW - 60_000)], { now: NOW, unreadFrom: null })).toHaveLength(1)
  })

  it('draws the unread line over the note that was unread on opening, below its day', () => {
    const shown = withDividers([noteItem('a', NOW - DAY), noteItem('b', NOW - 60_000)], {
      now: NOW,
      unreadFrom: 'b' as NoteId,
    })
    expect(shown.map((item) => item.key)).toEqual([
      `day:${new Date(NOW - DAY).toDateString()}`,
      'a',
      `day:${new Date(NOW).toDateString()}`,
      'unread',
      'b',
    ])
    expect(shown[3]).toEqual({ type: 'divider', key: 'unread', kind: 'unread', text: strings.unreadFromHere })
  })
})

describe('firstUnreadIn', () => {
  it('finds the earliest note someone else sent that the person has not read', () => {
    expect(firstUnreadIn([], ANA)).toBeNull()
    expect(firstUnreadIn([note('read'), note('mine', { authorId: ANA })], ANA)).toBeNull()
    const notes = [
      unread('late', { sentAt: 30 }),
      unread('early', { sentAt: 10, authorId: BEN }),
      unread('draft', { status: 'draft', sentAt: null, createdAt: 1 }),
      unread('middle', { sentAt: 20 }),
    ]
    expect(firstUnreadIn(notes, ANA)).toBe('early')
  })
})

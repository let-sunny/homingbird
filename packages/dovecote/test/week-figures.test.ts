import { describe, expect, it } from 'vitest'
import { DAY_MS, periodEndingAt } from '../src/domain/trust-figures.ts'
import { type WeekActivity, weekFiguresIn, yourWeekOf } from '../src/domain/week-figures.ts'

const NOW = 1_700_000_000_000
const HOUR = 60 * 60_000
const thisWeek = periodEndingAt(NOW, 7, 0)
const empty: WeekActivity = { sent: [], repliesReceived: [], ownReplies: [] }

describe('yourWeekOf', () => {
  it('compares the last seven days with the seven before', () => {
    const activity: WeekActivity = {
      sent: [NOW - HOUR, NOW - 2 * HOUR, NOW - 8 * DAY_MS],
      repliesReceived: [NOW - HOUR, NOW - 9 * DAY_MS, NOW - 10 * DAY_MS],
      ownReplies: [],
      approvedForChannels: [NOW - HOUR, NOW - 8 * DAY_MS, NOW - 9 * DAY_MS],
    }
    expect(yourWeekOf(activity, NOW)).toEqual({
      days: 7,
      current: { notesSent: 2, repliesReceived: 1, medianReplyMs: null, approvedForChannels: 1 },
      previous: { notesSent: 1, repliesReceived: 2, medianReplyMs: null, approvedForChannels: 2 },
    })
  })
})

describe('weekFiguresIn', () => {
  it('times each note from when it was sent to the first reply, ignoring later replies', () => {
    const activity: WeekActivity = {
      ...empty,
      ownReplies: [
        { originalId: 'a', originalSentAt: NOW - 5 * HOUR, repliedAt: NOW - 2 * HOUR },
        { originalId: 'a', originalSentAt: NOW - 5 * HOUR, repliedAt: NOW - 4 * HOUR },
        { originalId: 'a', originalSentAt: NOW - 5 * HOUR, repliedAt: NOW - 3 * HOUR },
        { originalId: 'b', originalSentAt: NOW - 6 * HOUR, repliedAt: NOW - 3 * HOUR },
      ],
    }
    expect(weekFiguresIn(activity, thisWeek).medianReplyMs).toBe(2 * HOUR)
  })

  it('counts a reply time in the period the colleague’s note was sent, even when the reply came later', () => {
    const activity: WeekActivity = {
      ...empty,
      ownReplies: [{ originalId: 'a', originalSentAt: NOW - 7 * DAY_MS - HOUR, repliedAt: NOW - HOUR }],
    }
    expect(weekFiguresIn(activity, thisWeek).medianReplyMs).toBeNull()
    expect(weekFiguresIn(activity, periodEndingAt(NOW, 7, 1)).medianReplyMs).toBe(7 * DAY_MS)
  })

  it('shows nothing for an empty week', () => {
    expect(weekFiguresIn(empty, thisWeek)).toEqual({
      notesSent: 0,
      repliesReceived: 0,
      medianReplyMs: null,
      approvedForChannels: 0,
    })
  })
})

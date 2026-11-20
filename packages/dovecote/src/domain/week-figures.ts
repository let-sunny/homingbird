import type { WeekFigures, YourWeek } from '@homingbird/protocol'
import { type Window, isIn, median, periodEndingAt } from './trust-figures.ts'

/** A colleague's new note the person replied to, with when it was sent and when one of their replies was. */
export interface OwnReply {
  readonly originalId: string
  readonly originalSentAt: number
  readonly repliedAt: number
}

export interface WeekActivity {
  readonly sent: ReadonlyArray<number>
  /** When the person sent a channel's agent's answer as one of its managers. */
  readonly approvedForChannels?: ReadonlyArray<number>
  readonly repliesReceived: ReadonlyArray<number>
  readonly ownReplies: ReadonlyArray<OwnReply>
}

/** The person's last 7 days of notes beside the 7 days before. */
export const yourWeekOf = (activity: WeekActivity, now: number): YourWeek => ({
  days: WEEK_DAYS,
  current: weekFiguresIn(activity, periodEndingAt(now, WEEK_DAYS, 0)),
  previous: weekFiguresIn(activity, periodEndingAt(now, WEEK_DAYS, 1)),
})

/** A reply time counts in the period the colleague's note was sent, as the organization's first-reply time does. */
export const weekFiguresIn = (activity: WeekActivity, window: Window): WeekFigures => {
  const firstReplies = new Map<string, OwnReply>()
  for (const reply of activity.ownReplies) {
    const earliest = firstReplies.get(reply.originalId)
    if (earliest === undefined || reply.repliedAt < earliest.repliedAt)
      firstReplies.set(reply.originalId, reply)
  }
  return {
    notesSent: activity.sent.filter((at) => isIn(window, at)).length,
    approvedForChannels: (activity.approvedForChannels ?? []).filter((at) => isIn(window, at)).length,
    repliesReceived: activity.repliesReceived.filter((at) => isIn(window, at)).length,
    medianReplyMs: median(
      [...firstReplies.values()]
        .filter((reply) => isIn(window, reply.originalSentAt))
        .map((reply) => reply.repliedAt - reply.originalSentAt),
    ),
  }
}

export const WEEK_DAYS = 7

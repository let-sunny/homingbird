import { type AsRead, type MemberId, SCHEDULE_WINDOW_MAX_DAYS } from '@homingbird/protocol'
import { strings } from '../strings.ts'

/**
 * What whoever opened a scheduling flock can do once it has settled or ended: open it again with the same
 * people and length, in the same window or a wider one. Nothing for anyone else, or while it takes answers.
 */
export const schedulingRetryModel = (input: SchedulingRetryInput): SchedulingRetryModel | null => {
  const { debate, viewerId } = input
  const schedule = debate.schedule
  if (schedule == null || debate.createdBy !== viewerId) return null
  if (debate.status !== 'closed' && debate.status !== 'ended') return null
  const noTime = debate.status === 'ended' || debate.result?.result.kind === 'no_slot'
  return {
    title: strings.scheduling.retryTitle,
    hint: strings.scheduling.retryHint,
    actions: [
      { name: 'again', label: strings.scheduling.retryAgain, window: null, emphasis: 'plain' },
      {
        name: 'wider',
        label: strings.scheduling.retryWider,
        window: widerWindow(schedule.window, input.now),
        emphasis: noTime ? 'primary' : 'plain',
      },
    ],
  }
}

/**
 * A window that starts no earlier than now and runs a week longer, within the longest a flock may look;
 * one already that long moves on to the week after it.
 */
export const widerWindow = (window: TimeSpan, now: number): TimeSpan => {
  const startsAt = Math.max(window.startsAt, now)
  const endsAt = Math.min(window.endsAt + WEEK_MS, startsAt + SCHEDULE_WINDOW_MAX_DAYS * DAY_MS)
  if (endsAt > window.endsAt) return { startsAt, endsAt }
  const next = Math.max(window.endsAt, now)
  return { startsAt: next, endsAt: next + WEEK_MS }
}

export interface SchedulingRetryInput {
  readonly debate: AsRead.Debate
  readonly viewerId: MemberId
  readonly now: number
}

export interface SchedulingRetryModel {
  readonly title: string
  readonly hint: string
  readonly actions: ReadonlyArray<{
    readonly name: 'again' | 'wider'
    readonly label: string
    /** The window to ask for, or null for the flock's own. */
    readonly window: TimeSpan | null
    readonly emphasis: 'primary' | 'plain'
  }>
}

interface TimeSpan {
  readonly startsAt: number
  readonly endsAt: number
}

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

import type {
  AgentFigures,
  AgentReport,
  ChannelAgentFigures,
  ChannelAgentReport,
  MemberId,
  Note,
} from '@homingbird/protocol'
import type { Records } from './world.ts'

/**
 * The visitor's agent over the last 7 and 30 days and 8 weeks: seeded figures for the time before the
 * demo, and every draft the visitor sent or discarded since it started counted on top.
 */
export const agentReportOf = (
  records: Records,
  viewerId: MemberId,
  startedAt: number,
  now: number,
): AgentReport => {
  const decided = decisionsSince(
    records,
    startedAt,
    (note) => note.authorId === viewerId && note.origin !== 'human',
  )
  return {
    generatedAt: now,
    quickApprovalSeconds: QUICK_APPROVAL_SECONDS,
    minimumDecided: MINIMUM_DECIDED,
    periods: [
      { days: 7, current: withDecisions(WEEK, decided), previous: WEEK_BEFORE },
      { days: 30, current: withDecisions(MONTH, decided), previous: MONTH_BEFORE },
    ],
    weeks: WEEKLY_AS_WRITTEN.map(([decidedThatWeek, sentAsWritten], index) => ({
      start: now - (WEEKLY_AS_WRITTEN.length - index) * WEEK_MS,
      decided: decidedThatWeek + (index === WEEKLY_AS_WRITTEN.length - 1 ? decided.total : 0),
      sentAsWritten: sentAsWritten + (index === WEEKLY_AS_WRITTEN.length - 1 ? decided.asWritten : 0),
    })),
    sessions: { days: 30, byAge: [], byContext: [], latest: [] },
    week: {
      days: 7,
      current: {
        notesSent: 14 + sentSince(records, startedAt, viewerId),
        repliesReceived: 9,
        medianReplyMs: 22 * MINUTE,
        approvedForChannels: 3 + approvedSince(records, startedAt, viewerId),
      },
      previous: { notesSent: 11, repliesReceived: 8, medianReplyMs: 41 * MINUTE, approvedForChannels: 1 },
    },
  }
}

/** How a channel's agent is doing, for its managers: seeded weeks and the answers decided since. */
export const channelAgentReportOf = (
  records: Records,
  slug: string,
  agentId: MemberId,
  startedAt: number,
  now: number,
): ChannelAgentReport => {
  const decided = decisionsSince(records, startedAt, (note) => note.authorId === agentId)
  const waiting = records.notes.filter((note) => note.authorId === agentId && note.status === 'draft').length
  const approvals = (base: ChannelAgentFigures): ChannelAgentFigures => ({
    ...base,
    written: base.written + decided.total,
    sentAsWritten: base.sentAsWritten + decided.asWritten,
    sentAfterEdits: base.sentAfterEdits + decided.edited,
    discarded: base.discarded + decided.discarded,
  })
  return {
    generatedAt: now,
    channel: slug,
    quickApprovalSeconds: QUICK_APPROVAL_SECONDS,
    minimumGroupSize: MINIMUM_GROUP_SIZE,
    waiting,
    periods: [
      { days: 7, current: approvals(CHANNEL_WEEK), previous: CHANNEL_WEEK_BEFORE },
      { days: 30, current: approvals(CHANNEL_MONTH), previous: CHANNEL_MONTH_BEFORE },
    ],
  }
}

interface Decisions {
  readonly total: number
  readonly asWritten: number
  readonly edited: number
  readonly discarded: number
}

const decisionsSince = (
  records: Records,
  startedAt: number,
  isCounted: (note: Note) => boolean,
): Decisions => {
  const decided = records.notes.filter(
    (note) =>
      isCounted(note) &&
      ((note.status === 'sent' && (note.sentAt ?? 0) >= startedAt) ||
        (note.status === 'discarded' && note.updatedAt >= startedAt)),
  )
  const asWritten = decided.filter((note) => note.status === 'sent' && note.origin === 'agent').length
  const edited = decided.filter((note) => note.status === 'sent' && note.origin === 'human_edited').length
  return { total: decided.length, asWritten, edited, discarded: decided.length - asWritten - edited }
}

const withDecisions = (base: AgentFigures, decided: Decisions): AgentFigures => ({
  ...base,
  written: base.written + decided.total,
  sentAsWritten: base.sentAsWritten + decided.asWritten,
  sentAfterEdits: base.sentAfterEdits + decided.edited,
  discarded: base.discarded + decided.discarded,
})

const sentSince = (records: Records, startedAt: number, viewerId: MemberId): number =>
  records.notes.filter(
    (note) => note.authorId === viewerId && note.status === 'sent' && (note.sentAt ?? 0) >= startedAt,
  ).length

const approvedSince = (records: Records, startedAt: number, viewerId: MemberId): number =>
  records.notes.filter((note) => note.approvedBy === viewerId && (note.sentAt ?? 0) >= startedAt).length

const MINUTE = 60_000
const WEEK_MS = 7 * 24 * 60 * MINUTE
const QUICK_APPROVAL_SECONDS = 3
const MINIMUM_DECIDED = 10
const MINIMUM_GROUP_SIZE = 3

const figures = (
  written: number,
  sentAsWritten: number,
  sentAfterEdits: number,
  discarded: number,
  wroteYourself: number,
): AgentFigures => ({
  written,
  sentAsWritten,
  sentAfterEdits,
  discarded,
  skipped: 1,
  skipReasons: [{ reason: 'The question was about salaries; June answers those directly.', count: 1 }],
  expiredRequests: 0,
  medianDecisionMs: 3 * MINUTE,
  quickApprovals: 1,
  quickApprovalsFrequent: false,
  wroteYourself,
  verdict: 'usually_as_written',
  places: [
    {
      place: 'billing',
      written: Math.round(written / 2),
      sentAsWritten: Math.round(sentAsWritten / 2),
      sentAfterEdits: Math.round(sentAfterEdits / 2),
      discarded: Math.round(discarded / 2),
      skipped: 0,
      verdict: 'usually_as_written',
    },
    {
      place: null,
      written: written - Math.round(written / 2),
      sentAsWritten: sentAsWritten - Math.round(sentAsWritten / 2),
      sentAfterEdits: sentAfterEdits - Math.round(sentAfterEdits / 2),
      discarded: discarded - Math.round(discarded / 2),
      skipped: 1,
      verdict: 'mixed',
    },
  ],
  byClient: [{ label: 'Homingbird CLI', written, sentAsWritten, sentAfterEdits, discarded }],
  byModel: [],
})

const WEEK = figures(18, 12, 4, 2, 6)
const WEEK_BEFORE = figures(15, 8, 4, 3, 7)
const MONTH = figures(64, 41, 15, 8, 25)
const MONTH_BEFORE = figures(52, 30, 13, 9, 29)

/** Drafts decided and sent as written, week by week, the oldest first. */
const WEEKLY_AS_WRITTEN: ReadonlyArray<readonly [number, number]> = [
  [9, 4],
  [11, 6],
  [10, 6],
  [14, 8],
  [12, 8],
  [15, 9],
  [16, 11],
  [18, 12],
]

const channelFigures = (
  written: number,
  sentAsWritten: number,
  sentAfterEdits: number,
  discarded: number,
): ChannelAgentFigures => ({
  written,
  sentAsWritten,
  sentAfterEdits,
  discarded,
  medianDecisionMs: 6 * MINUTE,
  quickApprovals: 0,
  approvals: null,
})

const CHANNEL_WEEK = channelFigures(9, 6, 2, 1)
const CHANNEL_WEEK_BEFORE = channelFigures(7, 4, 2, 1)
const CHANNEL_MONTH = channelFigures(31, 20, 7, 4)
const CHANNEL_MONTH_BEFORE = channelFigures(22, 13, 6, 3)

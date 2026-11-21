import {
  type AgentFigures,
  type AgentReport,
  type ChannelAgentFigures,
  type ChannelAgentReport,
  MemberId,
  type Note,
  type OrganizationFigures,
  type OrganizationInsights,
  TRUST_MINIMUM_DECIDED,
} from '@homingbird/protocol'
import { VISITOR_ID } from './team.ts'
import { verdictOf } from './trust-verdict.ts'
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
    minimumDecided: TRUST_MINIMUM_DECIDED,
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

const withDecisions = (base: AgentFigures, decided: Decisions): AgentFigures => {
  const sentAsWritten = base.sentAsWritten + decided.asWritten
  const sentAfterEdits = base.sentAfterEdits + decided.edited
  const discarded = base.discarded + decided.discarded
  return {
    ...base,
    written: base.written + decided.total,
    sentAsWritten,
    sentAfterEdits,
    discarded,
    verdict: verdictOf(sentAsWritten, sentAfterEdits, discarded),
  }
}

const sentSince = (records: Records, startedAt: number, viewerId: MemberId): number =>
  records.notes.filter(
    (note) => note.authorId === viewerId && note.status === 'sent' && (note.sentAt ?? 0) >= startedAt,
  ).length

const approvedSince = (records: Records, startedAt: number, viewerId: MemberId): number =>
  records.notes.filter((note) => note.approvedBy === viewerId && (note.sentAt ?? 0) >= startedAt).length

const MINUTE = 60_000
const WEEK_MS = 7 * 24 * 60 * MINUTE
const QUICK_APPROVAL_SECONDS = 3
const MINIMUM_GROUP_SIZE = 1

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
  verdict: verdictOf(sentAsWritten, sentAfterEdits, discarded),
  places: [
    {
      place: 'billing',
      written: Math.round(written / 2),
      sentAsWritten: Math.round(sentAsWritten / 2),
      sentAfterEdits: Math.round(sentAfterEdits / 2),
      discarded: Math.round(discarded / 2),
      skipped: 0,
      verdict: verdictOf(
        Math.round(sentAsWritten / 2),
        Math.round(sentAfterEdits / 2),
        Math.round(discarded / 2),
      ),
    },
    {
      place: null,
      written: written - Math.round(written / 2),
      sentAsWritten: sentAsWritten - Math.round(sentAsWritten / 2),
      sentAfterEdits: sentAfterEdits - Math.round(sentAfterEdits / 2),
      discarded: discarded - Math.round(discarded / 2),
      skipped: 1,
      verdict: verdictOf(
        sentAsWritten - Math.round(sentAsWritten / 2),
        sentAfterEdits - Math.round(sentAfterEdits / 2),
        discarded - Math.round(discarded / 2),
      ),
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
  approvals: [
    {
      memberId: MemberId.of('demoana00000'),
      name: 'Ana Silva',
      approved: Math.floor((sentAsWritten + sentAfterEdits) / 2),
    },
    { memberId: VISITOR_ID, name: 'June Park', approved: Math.ceil((sentAsWritten + sentAfterEdits) / 2) },
  ],
})

const CHANNEL_WEEK = channelFigures(9, 6, 2, 1)
const CHANNEL_WEEK_BEFORE = channelFigures(7, 4, 2, 1)
const CHANNEL_MONTH = channelFigures(31, 20, 7, 4)
const CHANNEL_MONTH_BEFORE = channelFigures(22, 13, 6, 3)

/** The organization's week and month for its administrator: counts only, never a person's. */
export const organizationInsightsOf = (now: number): OrganizationInsights => ({
  generatedAt: now,
  quickApprovalSeconds: QUICK_APPROVAL_SECONDS,
  minimumGroupSize: MINIMUM_GROUP_SIZE,
  blocks: 0,
  periods: [
    { days: 7, current: organization(5, 61, 1), previous: organization(5, 48, 0.8) },
    { days: 30, current: organization(5, 214, 3.5), previous: organization(4, 170, 2.8) },
  ],
  weeks: WEEKLY_AS_WRITTEN.map(([decided, sentAsWritten], index) => ({
    start: now - (WEEKLY_AS_WRITTEN.length - index) * WEEK_MS,
    sentAsWritten: sentAsWritten * 3,
    quickApprovals: Math.round(decided / 5),
  })),
  quickWarning: false,
})

const organization = (activeMembers: number, notesSent: number, scale: number): OrganizationFigures => ({
  activeMembers,
  notesSent,
  newNotes: Math.round(notesSent * 0.45),
  answered: Math.round(notesSent * 0.4),
  medianFirstReplyMs: 26 * MINUTE,
  agentDraftsWritten: Math.round(40 * scale),
  sentAsWritten: Math.round(26 * scale),
  sentAfterEdits: Math.round(9 * scale),
  discarded: Math.round(5 * scale),
  quickApprovals: Math.round(2 * scale),
  skipped: Math.round(2 * scale),
  debateResultsSent: Math.round(1 * scale),
  places: [
    {
      place: 'billing',
      notesSent: Math.round(notesSent * 0.4),
      sentAsWritten: Math.round(14 * scale),
      sentAfterEdits: Math.round(4 * scale),
      discarded: Math.round(2 * scale),
      skipped: 0,
    },
    {
      place: null,
      notesSent: Math.round(notesSent * 0.5),
      sentAsWritten: Math.round(12 * scale),
      sentAfterEdits: Math.round(5 * scale),
      discarded: Math.round(3 * scale),
      skipped: Math.round(2 * scale),
    },
  ],
  hiddenPlaces: 0,
  byClient: [
    {
      label: 'Homingbird CLI',
      written: Math.round(40 * scale),
      sentAsWritten: Math.round(26 * scale),
      sentAfterEdits: Math.round(9 * scale),
      discarded: Math.round(5 * scale),
    },
  ],
  byModel: [],
  hiddenLabels: 0,
  medianDecisionMs: 4 * MINUTE,
  authorship: {
    agent: Math.round(26 * scale),
    humanEdited: Math.round(9 * scale),
    human: Math.round(notesSent * 0.4),
  },
  delivery: {
    received: Math.round(notesSent * 0.9),
    toAgents: Math.round(notesSent * 0.7),
    pickedUpQuickly: Math.round(notesSent * 0.6),
    medianPickupMs: 40_000,
    waitedWithoutAgent: Math.round(notesSent * 0.1),
  },
  channelAgents: {
    written: Math.round(9 * scale),
    sentAsWritten: Math.round(6 * scale),
    sentAfterEdits: Math.round(2 * scale),
    discarded: Math.round(1 * scale),
  },
  teams: [
    {
      team: 'Customer',
      activeMembers: 2,
      notesSent: Math.round(notesSent * 0.35),
      sentAsWritten: Math.round(10 * scale),
      sentAfterEdits: Math.round(3 * scale),
      discarded: Math.round(2 * scale),
      quickApprovals: Math.round(1 * scale),
      medianDecisionMs: 5 * MINUTE,
      skipped: Math.round(1 * scale),
    },
    {
      team: 'Platform',
      activeMembers: 2,
      notesSent: Math.round(notesSent * 0.45),
      sentAsWritten: Math.round(12 * scale),
      sentAfterEdits: Math.round(4 * scale),
      discarded: Math.round(2 * scale),
      quickApprovals: Math.round(1 * scale),
      medianDecisionMs: 3 * MINUTE,
      skipped: Math.round(1 * scale),
    },
    {
      team: 'Security, Privacy, Compliance and Vendor Risk Management',
      activeMembers: 1,
      notesSent: Math.round(notesSent * 0.2),
      sentAsWritten: Math.round(4 * scale),
      sentAfterEdits: Math.round(2 * scale),
      discarded: Math.round(1 * scale),
      quickApprovals: 0,
      medianDecisionMs: 6 * MINUTE,
      skipped: 0,
    },
  ],
  hiddenTeams: 0,
})

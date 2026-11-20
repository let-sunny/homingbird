import type {
  Authorship,
  OrganizationFigures,
  OrganizationInsights,
  OrganizationLabelTotals,
  PlaceName,
  PlaceTotals,
} from '@homingbird/protocol'
import { type ReviewedDraft, channelAgentTotalsIn } from './channel-agent-figures.ts'
import { type ReceivedNote, deliveryIn } from './delivery-figures.ts'
import { placesShown } from './disclosure.ts'
import { quickWeeksOf } from './quick-weeks.ts'
import {
  type AgentDraft,
  type Decisions,
  PERIOD_DAYS,
  type Window,
  byPlace,
  decidedCount,
  decisionTime,
  decisionsOf,
  isIn,
  isQuickApproval,
  labelTotals,
  median,
  periodEndingAt,
} from './trust-figures.ts'

export interface SentNote {
  readonly id: string
  readonly authorId: string
  readonly place: PlaceName
  readonly sentAt: number
  readonly inReplyTo: string | null
  /** Who wrote what was sent: `agent`, `human_edited` or `human`. */
  readonly origin: string
}

export interface MemberDraft extends AgentDraft {
  /** Who decided it: its author, or the manager who sent a channel's agent's answer; null when nobody is known. */
  readonly authorId: string | null
}

export interface MemberSkip {
  /** Null for a channel's agent, which is not a person. */
  readonly memberId: string | null
  readonly place: PlaceName
  readonly at: number
}

export interface OrganizationActivity {
  readonly sent: ReadonlyArray<SentNote>
  readonly drafts: ReadonlyArray<MemberDraft>
  readonly skips: ReadonlyArray<MemberSkip>
  readonly received: ReadonlyArray<ReceivedNote>
  /** Sent debate results: neither agent drafts nor notes, so they count only here. */
  readonly debateResults?: ReadonlyArray<{ readonly authorId: string; readonly sentAt: number }>
  readonly channelAgentDrafts?: ReadonlyArray<ReviewedDraft>
}

export interface PrivacySettings {
  readonly quickApprovalSeconds: number
  readonly minimumGroupSize: number
}

export const organizationInsightsOf = (
  activity: OrganizationActivity,
  people: { readonly members: number; readonly blocks: number },
  now: number,
  settings: PrivacySettings,
): OrganizationInsights => ({
  generatedAt: now,
  quickApprovalSeconds: settings.quickApprovalSeconds,
  minimumGroupSize: settings.minimumGroupSize,
  blocks: people.members >= settings.minimumGroupSize ? people.blocks : null,
  periods: PERIOD_DAYS.map((days) => ({
    days,
    current: organizationFiguresIn(activity, periodEndingAt(now, days, 0), now, settings),
    previous: organizationFiguresIn(activity, periodEndingAt(now, days, 1), now, settings),
  })),
  ...quickWeeksOf(activity.drafts, now, settings),
})

/** Totals for one period, or null when fewer people than the minimum were active in it. */
export const organizationFiguresIn = (
  activity: OrganizationActivity,
  window: Window,
  now: number,
  settings: PrivacySettings,
): OrganizationFigures | null => {
  const sent = activity.sent.filter((note) => isIn(window, note.sentAt))
  const activeMembers = new Set(sent.map((note) => note.authorId)).size
  if (activeMembers < settings.minimumGroupSize) return null
  const decided = activity.drafts.filter((draft) => isIn(window, draft.decidedAt) && draft.outcome !== null)
  const skips = activity.skips.filter((skip) => isIn(window, skip.at))
  const newNotes = sent.filter((note) => note.inReplyTo === null)
  const firstReplies = firstRepliesOf(activity.sent)
  const replyTimes = newNotes.flatMap((note) => {
    const first = firstReplies.get(note.id)
    return first === undefined ? [] : [first - note.sentAt]
  })
  const groups = groupsByPlace(sent, decided, skips)
  const { shown, hidden } = placesShown(
    [...groups.values()].map((group) => ({ place: group.totals.place, people: group.people })),
    settings.minimumGroupSize,
  )
  const draftsShown = peopleOf(decided.map((draft) => draft.authorId)).size >= settings.minimumGroupSize
  const decidedPlaces = placesShown(
    [...Map.groupBy(decided, (draft) => draft.place)].map(([place, drafts]) => ({
      place,
      people: peopleOf(drafts.map((draft) => draft.authorId)),
    })),
    settings.minimumGroupSize,
  ).hidden
  return {
    activeMembers,
    notesSent: sent.length,
    newNotes: newNotes.length,
    answered: replyTimes.length,
    medianFirstReplyMs: median(replyTimes),
    agentDraftsWritten: activity.drafts.filter((draft) => isIn(window, draft.createdAt)).length,
    ...(draftsShown ? decisionsOf(decided) : HIDDEN_DECISIONS),
    quickApprovals: draftsShown
      ? decided.filter((draft) => isQuickApproval(draft, settings.quickApprovalSeconds)).length
      : null,
    skipped: skips.length,
    debateResultsSent: debateResultsShown(activity, window, settings.minimumGroupSize),
    ...labelsShown(activity.drafts, window, settings.minimumGroupSize, draftsShown),
    places: shown
      .map((place) => groups.get(place)!.totals)
      .sort(
        (a, b) => b.notesSent - a.notesSent || decidedCount(b) - decidedCount(a) || byPlace(a.place, b.place),
      )
      .map((totals) =>
        draftsShown && !decidedPlaces.includes(totals.place) ? totals : { ...totals, ...HIDDEN_DECISIONS },
      ),
    hiddenPlaces: hidden.length,
    medianDecisionMs: medianDecisionShown(decided, settings.minimumGroupSize),
    authorship: draftsShown ? authorshipOf(sent) : null,
    delivery: deliveryIn(activity.received, window, now, settings.minimumGroupSize),
    channelAgents: channelAgentTotalsIn(activity.channelAgentDrafts ?? [], window, settings.minimumGroupSize),
  }
}

/** The people among some contributors, leaving out those nobody knows. */
export const peopleOf = (ids: Iterable<string | null>): Set<string> =>
  new Set([...ids].filter((id): id is string => id !== null))

/** The sent debate results, or null while fewer people than the minimum sent one. */
const debateResultsShown = (
  activity: OrganizationActivity,
  window: Window,
  minimum: number,
): number | null => {
  const sent = (activity.debateResults ?? []).filter((note) => isIn(window, note.sentAt))
  return new Set(sent.map((note) => note.authorId)).size >= minimum ? sent.length : null
}

/** The typical decision time, or null while fewer people than the minimum have a decision with a time. */
const medianDecisionShown = (decided: ReadonlyArray<MemberDraft>, minimum: number): number | null => {
  const timed = decided.flatMap((draft) => {
    const time = decisionTime(draft)
    return time === null ? [] : [{ authorId: draft.authorId, time }]
  })
  return peopleOf(timed.map((draft) => draft.authorId)).size >= minimum
    ? median(timed.map((draft) => draft.time))
    : null
}

const authorshipOf = (sent: ReadonlyArray<SentNote>): Authorship => ({
  agent: sent.filter((note) => note.origin === 'agent').length,
  humanEdited: sent.filter((note) => note.origin === 'human_edited').length,
  human: sent.filter((note) => note.origin === 'human').length,
})

const HIDDEN_DECISIONS = { sentAsWritten: null, sentAfterEdits: null, discarded: null } as const

interface PlaceGroup {
  readonly totals: PlaceTotals & Decisions
  readonly people: ReadonlySet<string>
}

const groupsByPlace = (
  sent: ReadonlyArray<SentNote>,
  decided: ReadonlyArray<MemberDraft>,
  skips: ReadonlyArray<MemberSkip>,
): Map<PlaceName, PlaceGroup> => {
  const notesBy = Map.groupBy(sent, (note) => note.place)
  const draftsBy = Map.groupBy(decided, (draft) => draft.place)
  const skipsBy = Map.groupBy(skips, (skip) => skip.place)
  const places = new Set<PlaceName>([...notesBy.keys(), ...draftsBy.keys(), ...skipsBy.keys()])
  return new Map(
    [...places].map((place) => {
      const notes = notesBy.get(place) ?? []
      const drafts = draftsBy.get(place) ?? []
      const skipped = skipsBy.get(place) ?? []
      const people = peopleOf([
        ...notes.map((note) => note.authorId),
        ...drafts.map((draft) => draft.authorId),
        ...skipped.map((skip) => skip.memberId),
      ])
      const totals = { place, notesSent: notes.length, ...decisionsOf(drafts), skipped: skipped.length }
      return [place, { totals, people }]
    }),
  )
}

const firstRepliesOf = (sent: ReadonlyArray<SentNote>): Map<string, number> => {
  const authors = new Map(sent.map((note) => [note.id, note.authorId]))
  const first = new Map<string, number>()
  for (const reply of sent) {
    if (reply.inReplyTo === null || authors.get(reply.inReplyTo) === reply.authorId) continue
    const earliest = first.get(reply.inReplyTo)
    if (earliest === undefined || reply.sentAt < earliest) first.set(reply.inReplyTo, reply.sentAt)
  }
  return first
}

/**
 * Programs and models used by at least the minimum people. A shown label's decisions need the minimum
 * of people who decided its drafts too, with the same rule for what is hidden together, and are never
 * shown while the organization's own decisions are hidden.
 */
const labelsShown = (
  drafts: ReadonlyArray<MemberDraft>,
  window: Window,
  minimum: number,
  draftsShown: boolean,
): { byClient: OrganizationLabelTotals[]; byModel: OrganizationLabelTotals[]; hiddenLabels: number } => {
  const inWindow = drafts.filter(
    (draft) => isIn(window, draft.createdAt) || (isIn(window, draft.decidedAt) && draft.outcome !== null),
  )
  const shownFor = (labelOf: (draft: MemberDraft) => string | null) => {
    const people = Map.groupBy(inWindow, labelOf)
    const { shown, hidden } = placesShown(
      [...people].map(([label, group]) => ({
        place: label,
        people: peopleOf(group.map((draft) => draft.authorId)),
      })),
      minimum,
    )
    const decided = inWindow.filter((draft) => isIn(window, draft.decidedAt) && draft.outcome !== null)
    const decisionsHidden = placesShown(
      [...Map.groupBy(decided, labelOf)].map(([label, group]) => ({
        place: label,
        people: peopleOf(group.map((draft) => draft.authorId)),
      })),
      minimum,
    ).hidden
    return {
      totals: labelTotals(inWindow, window, labelOf)
        .filter((totals) => shown.includes(totals.label))
        .map((totals) =>
          draftsShown && !decisionsHidden.includes(totals.label)
            ? totals
            : { ...totals, ...HIDDEN_DECISIONS },
        ),
      hidden: hidden.length,
    }
  }
  const clients = shownFor((draft) => draft.client ?? null)
  const models = shownFor((draft) => draft.model ?? null)
  return { byClient: clients.totals, byModel: models.totals, hiddenLabels: clients.hidden + models.hidden }
}

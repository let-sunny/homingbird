import type { TeamTotals } from '@homingbird/protocol'
import { type Contribution, isEnough, peopleOf, teamsShown } from './disclosure.ts'
import type { MemberDraft, MemberSkip, PrivacySettings, SentNote } from './organization-figures.ts'
import {
  DAY_MS,
  type Window,
  decisionTime,
  decisionsOf,
  isIn,
  isQuickApproval,
  median,
} from './trust-figures.ts'

/**
 * Each team's totals for a period, alphabetically, with the teams too small to show only counted. A
 * person counts for a team on every UTC day they were in it for any part of; a team, and its decisions
 * apart, are shown only while the cell rule allows, and its typical decision time needs that many
 * people who decided a draft they had seen.
 */
export const teamRowsIn = (
  activity: TeamActivity,
  membership: TeamMembership,
  window: Window,
  settings: PrivacySettings,
  draftsShown: boolean,
): { readonly teams: TeamTotals[]; readonly hiddenTeams: number } => {
  const teamsOf = teamsOnDay(membership)
  const sent = activity.sent.filter((note) => isIn(window, note.sentAt))
  const decided = activity.drafts.filter((draft) => isIn(window, draft.decidedAt) && draft.outcome !== null)
  const skips = activity.skips.filter((skip) => isIn(window, skip.at))
  const decisions = contributionsOf(decided, (draft) => [draft.authorId, draft.decidedAt!], teamsOf)
  const everything = [
    ...contributionsOf(sent, (note) => [note.authorId, note.sentAt], teamsOf),
    ...decisions,
    ...contributionsOf(skips, (skip) => [skip.memberId, skip.at], teamsOf),
  ]
  const minimum = settings.minimumGroupSize
  const showsAll = minimum <= 1
  const shown = new Set(teamsShown(everything, minimum).shown)
  const decisionsShownFor = new Set(teamsShown(decisions, minimum).shown)
  const rows = membership.teams
    .filter((team) => showsAll || shown.has(team.id))
    .map((team) => {
      const inTeam = <T>(items: ReadonlyArray<T>, at: (item: T) => [string | null, number]) =>
        items.filter((item) => {
          const [person, when] = at(item)
          return person !== null && teamsOf(person, when).includes(team.id)
        })
      const notes = inTeam(sent, (note) => [note.authorId, note.sentAt])
      const theirs = inTeam(decided, (draft) => [draft.authorId, draft.decidedAt!])
      const withDecisions = draftsShown && (showsAll || decisionsShownFor.has(team.id))
      const timed = theirs.filter((draft) => decisionTime(draft) !== null)
      const senders = peopleOf(notes.map((note) => note.authorId)).size
      const notesShown = isEnough(senders, minimum)
      return {
        team: team.name,
        activeMembers: notesShown ? senders : null,
        notesSent: notesShown ? notes.length : null,
        ...(withDecisions ? decisionsOf(theirs) : HIDDEN),
        quickApprovals: withDecisions
          ? theirs.filter((draft) => isQuickApproval(draft, settings.quickApprovalSeconds)).length
          : null,
        medianDecisionMs:
          withDecisions && isEnough(peopleOf(timed.map((draft) => draft.authorId)).size, minimum)
            ? median(timed.map((draft) => decisionTime(draft)!))
            : null,
        skipped: inTeam(skips, (skip) => [skip.memberId, skip.at]).length,
      }
    })
    .sort((a, b) => a.team.localeCompare(b.team))
  return { teams: rows, hiddenTeams: membership.teams.length - rows.length }
}

export interface TeamActivity {
  readonly sent: ReadonlyArray<SentNote>
  readonly drafts: ReadonlyArray<MemberDraft>
  readonly skips: ReadonlyArray<MemberSkip>
}

/** The organization's teams and who was in each when: `joinedAt` 0 began before records, `leftAt` null is now. */
export interface TeamMembership {
  readonly teams: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly spans: ReadonlyArray<{
    readonly teamId: string
    readonly memberId: string
    readonly joinedAt: number
    readonly leftAt: number | null
  }>
}

const HIDDEN = { sentAsWritten: null, sentAfterEdits: null, discarded: null } as const

const teamsOnDay = (membership: TeamMembership): ((person: string, at: number) => string[]) => {
  const byPerson = Map.groupBy(membership.spans, (span) => span.memberId)
  return (person, at) => {
    const day = Math.floor(at / DAY_MS) * DAY_MS
    return (byPerson.get(person) ?? [])
      .filter((span) => span.joinedAt < day + DAY_MS && (span.leftAt === null || span.leftAt > day))
      .map((span) => span.teamId)
  }
}

const contributionsOf = <T>(
  items: ReadonlyArray<T>,
  at: (item: T) => [string | null, number],
  teamsOf: (person: string, at: number) => string[],
): Contribution[] =>
  items.flatMap((item) => {
    const [person, when] = at(item)
    return person === null ? [] : [{ person, teams: teamsOf(person, when) }]
  })

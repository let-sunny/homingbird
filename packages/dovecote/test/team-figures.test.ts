import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { MemberDraft, SentNote } from '../src/domain/organization-figures.ts'
import { type TeamActivity, type TeamMembership, teamRowsIn } from '../src/domain/team-figures.ts'
import { DAY_MS, periodEndingAt } from '../src/domain/trust-figures.ts'

const NOW = Date.UTC(2026, 10, 20, 12)
const HOUR = 60 * 60_000
const lastWeek = periodEndingAt(NOW, 7, 0)
const DEFAULT = { quickApprovalSeconds: 3, minimumGroupSize: 1 }
const FIVE = { quickApprovalSeconds: 3, minimumGroupSize: 5 }

let notes = 0
const sent = (authorId: string | null, at = NOW - HOUR): SentNote => ({
  id: `n${++notes}`,
  authorId: authorId as string,
  place: null,
  sentAt: at,
  inReplyTo: null,
  origin: 'human',
})

const decided = (
  authorId: string | null,
  outcome: MemberDraft['outcome'] = 'as_written',
  seconds = 30,
  at = NOW - HOUR,
): MemberDraft => ({
  authorId,
  place: null,
  createdAt: at - HOUR,
  seenAt: at - seconds * 1000,
  decidedAt: at,
  outcome,
})

const people = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`)

const membership = (teams: Readonly<Record<string, ReadonlyArray<string>>>, since = 0): TeamMembership => ({
  teams: Object.keys(teams).map((name) => ({ id: `grp_${name}`, name })),
  spans: Object.entries(teams).flatMap(([name, members]) =>
    members.map((memberId) => ({ teamId: `grp_${name}`, memberId, joinedAt: since, leftAt: null })),
  ),
})

const activity = (fields: Partial<TeamActivity>): TeamActivity => ({
  sent: [],
  drafts: [],
  skips: [],
  ...fields,
})

describe('teamRowsIn', () => {
  it('shows a team of two by default, alphabetically, with its notes, decisions and skips', () => {
    const rows = teamRowsIn(
      activity({
        sent: [sent('ana'), sent('ana'), sent('ben'), sent('cy')],
        drafts: [decided('ana', 'as_written', 2), decided('ben', 'edited', 60), decided('cy', 'discarded')],
        skips: [{ memberId: 'ben', place: null, at: NOW - HOUR }],
      }),
      membership({ Payments: ['ana', 'ben'], Billing: ['cy'], Empty: [] }),
      lastWeek,
      DEFAULT,
      true,
    )
    expect(rows).toEqual({
      teams: [
        {
          team: 'Billing',
          activeMembers: 1,
          notesSent: 1,
          sentAsWritten: 0,
          sentAfterEdits: 0,
          discarded: 1,
          quickApprovals: 0,
          medianDecisionMs: 30_000,
          skipped: 0,
        },
        {
          team: 'Empty',
          activeMembers: 0,
          notesSent: 0,
          sentAsWritten: 0,
          sentAfterEdits: 0,
          discarded: 0,
          quickApprovals: 0,
          medianDecisionMs: null,
          skipped: 0,
        },
        {
          team: 'Payments',
          activeMembers: 2,
          notesSent: 3,
          sentAsWritten: 1,
          sentAfterEdits: 1,
          discarded: 0,
          quickApprovals: 1,
          medianDecisionMs: 31_000,
          skipped: 1,
        },
      ],
      hiddenTeams: 0,
    })
  })

  it('counts a person for a team only on the UTC days they were in it for some part of', () => {
    const today = Math.floor(NOW / DAY_MS) * DAY_MS
    const moved: TeamMembership = {
      teams: [
        { id: 'grp_a', name: 'A' },
        { id: 'grp_b', name: 'B' },
      ],
      spans: [
        { teamId: 'grp_a', memberId: 'ana', joinedAt: 0, leftAt: today - DAY_MS + HOUR },
        { teamId: 'grp_b', memberId: 'ana', joinedAt: today - DAY_MS + HOUR, leftAt: null },
      ],
    }
    const rows = teamRowsIn(
      activity({
        sent: [
          sent('ana', today - 3 * DAY_MS),
          sent('ana', today - DAY_MS + 2 * HOUR),
          sent('ana', today + HOUR),
        ],
      }),
      moved,
      lastWeek,
      DEFAULT,
      true,
    )
    expect(rows.teams.map((row) => [row.team, row.notesSent])).toEqual([
      ['A', 2],
      ['B', 2],
    ])
  })

  it('leaves out teams too small to show at a minimum of 5, and the one whose overlap is a small cell, counting them', () => {
    const rows = teamRowsIn(
      activity({
        sent: [...people(6, 'p'), ...people(7, 'b'), 'both', ...people(5, 'x'), ...people(3, 's')].map((id) =>
          sent(id),
        ),
      }),
      membership({
        Payments: [...people(6, 'p'), 'both'],
        Billing: [...people(7, 'b'), 'both'],
        Small: people(3, 's'),
      }),
      lastWeek,
      FIVE,
      true,
    )
    expect(rows.teams.map((row) => row.team)).toEqual(['Billing'])
    expect(rows.hiddenTeams).toBe(2)
  })

  it('hides a shown team’s decisions when the people who decided are too few, and every decision while the organization’s are hidden', () => {
    const team = people(6, 'p')
    const input = activity({
      sent: [...team, ...people(5, 'x')].map((id) => sent(id)),
      drafts: [decided('p0')],
    })
    const rows = teamRowsIn(input, membership({ Payments: team }), lastWeek, FIVE, true)
    expect(rows.teams[0]).toMatchObject({
      team: 'Payments',
      notesSent: 6,
      sentAsWritten: null,
      medianDecisionMs: null,
    })
    const hidden = teamRowsIn(
      activity({ sent: team.map((id) => sent(id)), drafts: team.map((id) => decided(id)) }),
      membership({ Payments: team }),
      lastWeek,
      DEFAULT,
      false,
    )
    expect(hidden.teams[0]).toMatchObject({
      sentAsWritten: null,
      quickApprovals: null,
      medianDecisionMs: null,
    })
  })

  it('hides a shown team’s notes while fewer than the minimum sent one, though skips made it large enough', () => {
    const team = people(5, 'p')
    const rows = teamRowsIn(
      activity({
        sent: [sent('p0'), ...people(5, 'x').map((id) => sent(id))],
        skips: team.slice(1).map((memberId) => ({ memberId, place: null, at: NOW - HOUR })),
      }),
      membership({ Payments: team }),
      lastWeek,
      FIVE,
      true,
    )
    expect(rows.teams[0]).toMatchObject({
      team: 'Payments',
      notesSent: null,
      activeMembers: null,
      skipped: 4,
    })
  })

  it('needs the minimum of people with a timed decision for a team’s typical decision time', () => {
    const team = people(5, 'p')
    const drafts = team.map((id, index) => ({ ...decided(id), seenAt: index === 0 ? null : NOW - 2 * HOUR }))
    const rows = teamRowsIn(
      activity({
        sent: [...team, ...people(5, 'x')].map((id) => sent(id)),
        drafts: [...drafts, ...people(5, 'x').map((id) => decided(id))],
      }),
      membership({ Payments: team }),
      lastWeek,
      FIVE,
      true,
    )
    expect(rows.teams[0]).toMatchObject({ sentAsWritten: 5, medianDecisionMs: null })
  })

  it('never counts a contribution nobody is known for, nor one outside the period', () => {
    const rows = teamRowsIn(
      activity({
        sent: [sent(null), sent('ana', NOW - 9 * DAY_MS)],
        drafts: [decided(null, 'discarded')],
        skips: [{ memberId: null, place: null, at: NOW - HOUR }],
      }),
      membership({ Payments: ['ana'] }),
      lastWeek,
      DEFAULT,
      true,
    )
    expect(rows.teams[0]).toMatchObject({ activeMembers: 0, notesSent: 0, discarded: 0, skipped: 0 })
  })

  it('never shows a team at a raised minimum whose people, or the cells it draws, are too few', () => {
    const person = fc.constantFrom(...people(14, 'm'))
    fc.assert(
      fc.property(
        fc.array(person, { maxLength: 30 }),
        fc.dictionary(fc.constantFrom('A', 'B', 'C'), fc.uniqueArray(person, { maxLength: 10 })),
        fc.integer({ min: 2, max: 5 }),
        (senders, teams, minimum) => {
          const shape = membership(teams)
          const rows = teamRowsIn(
            activity({ sent: senders.map((id) => sent(id)) }),
            shape,
            lastWeek,
            { quickApprovalSeconds: 3, minimumGroupSize: minimum },
            true,
          )
          expect(rows.teams.length + rows.hiddenTeams).toBe(shape.teams.length)
          for (const row of rows.teams) expect(row.activeMembers).toBeGreaterThanOrEqual(minimum)
        },
      ),
    )
  })
})

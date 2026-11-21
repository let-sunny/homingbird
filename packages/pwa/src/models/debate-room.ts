import { type AsRead, type MemberId, UNKNOWN } from '@homingbird/protocol'
import { channelLabel } from '../channels.ts'
import {
  type DebateStage,
  debateStage,
  draftsOf,
  graceOf,
  mayChangeLimits,
  mayOptIn,
  tookATurn,
  turnsLeftFor,
} from '../debates.ts'
import { DEBATE_TABS, type DebateTab, hrefFor } from '../routes.ts'
import { formats, strings } from '../strings.ts'
import { debateAuthorModel } from './debate-author.ts'
import {
  type CreditBadge,
  type ResultBody,
  type ResultModel,
  type RoomPeople,
  creditBadgeOf,
  resultBody,
  resultModel,
} from './debate-result.ts'
import type { AuthorModel } from './note-item.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * One debate room, one short tab at a time: the result and what to do with it, how the agents voted, what
 * each one contributed, and the turns. A tab shows only once the room has something for it; a room still
 * taking turns opens on its turns, any later one on its result.
 */
export const debateRoomModel = (input: DebateRoomInput): DebateRoomModel => {
  const { debate, viewerId } = input
  if (debate === null) return { kind: 'loading' }
  if (debate === 'missing') return { kind: 'missing', text: strings.debates.notFound }
  const stage = debateStage(debate)
  const nameOf = (id: MemberId): string => input.members.get(id)?.name ?? strings.formerMember
  const people: RoomPeople = { nameOf, viewerId }
  const agentOf = (agent: string, memberId: MemberId): string =>
    memberId === viewerId
      ? strings.debates.mine.agentOf({ agent })
      : strings.debates.agentOf({ agent, person: nameOf(memberId) })
  const result =
    stage === 'awaiting-result' || stage === 'voting' || stage === 'closed'
      ? resultModel(debate, stage, people)
      : null
  const voteRecord = result?.kind === 'settled' ? result.voteRecord : null
  const credit = creditOf(debate.result?.result ?? null, people)
  const available = DEBATE_TABS.filter((tab) =>
    tab === 'result'
      ? result !== null || stage === 'ended'
      : tab === 'votes'
        ? stage === 'voting' || voteRecord !== null
        : tab === 'credit'
          ? credit !== null
          : true,
  )
  const shown =
    input.tab !== null && available.includes(input.tab)
      ? input.tab
      : available.includes('result')
        ? 'result'
        : 'turns'
  const turns = debate.turns.map((turn) => ({
    position: turn.position,
    mine: turn.memberId === viewerId,
    author: agentOf(turn.agentName, turn.memberId),
    details: debateAuthorModel(input, {
      id: `${debate.id}-turn-${turn.position}`,
      memberId: turn.memberId,
      agentName: turn.agentName,
      agentModel: turn.agentModel,
    }),
    time: timeShown(turn.at, input.now),
    body: turn.body,
  }))
  const earlier = turns.slice(0, Math.max(0, turns.length - LATEST_TURNS_SHOWN))
  return {
    kind: 'room',
    debate,
    tabs: available.map((tab) => ({
      tab,
      href: hrefFor({ name: 'debate', id: debate.id, tab }),
      label: strings.debates.tabs[tab],
      current: tab === shown,
    })),
    shown,
    focusesTab: input.tab !== null,
    question: debate.question,
    stage,
    stageText: strings.debates.stage[stage],
    isPrivate: debate.visibility === 'private',
    closesAt:
      debate.status === 'open' ? strings.debates.closesAt({ time: fullTime(debate.deadlineAt) }) : null,
    limits: strings.debates.limitsSummary({
      perAgent: debate.limits.turnsPerAgent,
      total: debate.limits.totalTurns,
      minutes: debate.limits.minutes,
      characters: debate.limits.turnCharacters,
    }),
    grace: strings.debates.graceSummary({ minutes: graceOf(debate.limits) }),
    mayChangeLimits: mayChangeLimits(debate, viewerId),
    limitsFixed: debate.status === 'open' && debate.turns.length > 0 && debate.createdBy === viewerId,
    participants: debate.participants.map((participant) => ({
      memberId: participant.memberId,
      name: agentOf(participant.agentName, participant.memberId),
      turnsLeft:
        debate.status === 'open'
          ? strings.debates.turnsLeft({ count: turnsLeftFor(debate, participant.memberId) })
          : null,
      droppedOut:
        participant.takingPart === false && (debate.status === 'open' || debate.status === 'concluding')
          ? strings.debates.droppedOut
          : null,
    })),
    optIn: mayOptIn(debate, viewerId)
      ? input.agents.length === 0
        ? { kind: 'no-agent', text: strings.debates.noAgent }
        : { kind: 'choose', agents: input.agents.map((agent) => ({ value: agent.id, label: agent.name })) }
      : null,
    turns:
      turns.length === 0
        ? {
            kind: 'none',
            text: stage === 'gathering' ? strings.debates.waitingForSecond : strings.debates.noTurns,
          }
        : {
            kind: 'turns',
            taken: strings.debates.turnsTaken({ count: turns.length, total: debate.limits.totalTurns }),
            timing: strings.debates.turnTimes({
              first: fullTime(debate.turns[0]!.at),
              last: fullTime(debate.turns[debate.turns.length - 1]!.at),
            }),
            earlier:
              earlier.length === 0
                ? null
                : { label: strings.debates.earlierTurns({ count: earlier.length }), turns: earlier },
            latest: turns.slice(earlier.length),
          },
    ended: stage === 'ended' ? strings.debates.ended[debate.endedBecause ?? 'no_turns'] : null,
    result,
    drafts:
      (debate.drafts ?? []).length === 0
        ? null
        : draftsOf(debate).map(({ draft, chosen }) => ({
            memberId: draft.draftedBy,
            chosen,
            title:
              draft.draftedBy === viewerId
                ? strings.debates.mine.draftOf
                : strings.debates.draftOf({ person: nameOf(draft.draftedBy) }),
            details: debateAuthorModel(input, {
              id: `${debate.id}-draft-${draft.draftedBy}`,
              memberId: draft.draftedBy,
              agentName:
                debate.participants.find((one) => one.memberId === draft.draftedBy)?.agentName ?? null,
              agentModel: draft.agentModel,
            }),
            votes: draft.votes === null ? null : strings.debates.votes({ count: draft.votes }),
            time: timeShown(draft.draftedAt, input.now),
            body: resultBody(draft.result, people),
          })),
    closed:
      stage === 'closed'
        ? {
            mayPost: tookATurn(debate, viewerId),
            channels: input.channels
              .filter((one) => one.joined)
              .map((one) => ({ value: one.slug, label: channelLabel(one.slug) })),
            people: input.directory
              .filter((entry) => entry.member.id !== viewerId && entry.canMessage)
              .map((entry) => ({ value: entry.member.id as string, label: entry.member.name })),
          }
        : null,
    votes: {
      voting: result?.kind === 'waiting' ? result.voting : null,
      record: voteRecord,
    },
    credit,
  }
}

/** Where a posted result goes: a channel chosen first, else a person, else nowhere yet. */
export const resultDestination = (
  channel: string,
  person: string,
): { readonly channel: string } | { readonly to: MemberId } | null =>
  channel !== '' ? { channel } : person !== '' ? { to: person as MemberId } : null

export interface DebateRoomInput {
  readonly debate: AsRead.Debate | 'missing' | null
  /** The tab asked for by the address, or null for the one the room's state calls for. */
  readonly tab: DebateTab | null
  readonly viewerId: MemberId
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly agents: ReadonlyArray<AsRead.Credential>
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly serverInfo: AsRead.ServerInfo | null
  readonly now: number
}

export type DebateRoomModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing'; readonly text: string }
  | {
      readonly kind: 'room'
      readonly debate: AsRead.Debate
      readonly tabs: ReadonlyArray<{
        readonly tab: DebateTab
        readonly href: string
        readonly label: string
        readonly current: boolean
      }>
      readonly shown: DebateTab
      /** Whether the shown tab takes focus once drawn, as it does after choosing a tab. */
      readonly focusesTab: boolean
      readonly question: string
      readonly stage: DebateStage
      readonly stageText: string
      readonly isPrivate: boolean
      readonly closesAt: string | null
      readonly limits: string
      readonly grace: string
      readonly mayChangeLimits: boolean
      readonly limitsFixed: boolean
      readonly participants: ReadonlyArray<{
        readonly memberId: MemberId
        readonly name: string
        readonly turnsLeft: string | null
        readonly droppedOut: string | null
      }>
      readonly optIn:
        | { readonly kind: 'no-agent'; readonly text: string }
        | {
            readonly kind: 'choose'
            readonly agents: ReadonlyArray<{ readonly value: string; readonly label: string }>
          }
        | null
      readonly turns:
        | { readonly kind: 'none'; readonly text: string }
        | {
            readonly kind: 'turns'
            readonly taken: string
            readonly timing: string
            /** The turns before the latest few, folded away behind their count. */
            readonly earlier: { readonly label: string; readonly turns: ReadonlyArray<Turn> } | null
            readonly latest: ReadonlyArray<Turn>
          }
      readonly ended: string | null
      readonly result: ResultModel | null
      readonly drafts: ReadonlyArray<{
        readonly memberId: MemberId
        readonly chosen: boolean
        readonly title: string
        readonly details: AuthorModel
        readonly votes: string | null
        readonly time: TimeShown
        readonly body: ResultBody
      }> | null
      readonly closed: {
        readonly mayPost: boolean
        readonly channels: ReadonlyArray<{ readonly value: string; readonly label: string }>
        readonly people: ReadonlyArray<{ readonly value: string; readonly label: string }>
      } | null
      readonly votes: {
        /** Until when the agents vote, and how many have, while the vote runs. */
        readonly voting: string | null
        readonly record: Extract<ResultModel, { kind: 'settled' }>['voteRecord']
      }
      readonly credit: ReadonlyArray<CreditRow> | null
    }

export interface Turn {
  readonly position: number
  readonly mine: boolean
  readonly author: string
  readonly details: AuthorModel
  readonly time: TimeShown
  readonly body: string
}

/** One agent's part in a settled result: its contribution and credits, and the next steps it proposed. */
export interface CreditRow {
  readonly memberId: MemberId
  readonly name: string
  readonly summary: string | null
  readonly credits: ReadonlyArray<CreditBadge>
  readonly keptSteps: ReadonlyArray<string>
}

const creditOf = (
  result: AsRead.DebateResult | null,
  { nameOf, viewerId }: RoomPeople,
): ReadonlyArray<CreditRow> | null => {
  if (result === null || result.kind === UNKNOWN) return null
  const contributed = result.contributions.map((contribution) => contribution.memberId)
  const proposersOnly = result.nextSteps
    .map((step) => step.proposedBy)
    .filter((memberId, index, all) => !contributed.includes(memberId) && all.indexOf(memberId) === index)
  return [...contributed, ...proposersOnly].map((memberId) => {
    const contribution = result.contributions.find((one) => one.memberId === memberId)
    return {
      memberId,
      name: memberId === viewerId ? strings.debates.mine.agent : nameOf(memberId),
      summary: contribution?.summary ?? null,
      credits: (contribution?.credits ?? []).map(creditBadgeOf),
      keptSteps: result.nextSteps.filter((step) => step.proposedBy === memberId).map((step) => step.step),
    }
  })
}

/** How many of the latest turns a room shows unfolded. */
const LATEST_TURNS_SHOWN = 6

const fullTime = (timestamp: number): string => formats.full.format(new Date(timestamp))

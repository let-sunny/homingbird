import { type AsRead, DEBATE_BRIEF_MAX, type MemberId, isReadyToConclude } from '@homingbird/protocol'
import { channelLabel } from '../channels.ts'
import { citedTurns } from '../debate-turns.ts'
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
  type CreditModel,
  type QuotedTurn,
  creditModel,
  creditedChanges,
  positionMoveIn,
  turnQuoted,
} from './debate-credit.ts'
import {
  type CitedText,
  type ResultBody,
  type ResultModel,
  type RoomPeople,
  resultBody,
  resultModel,
} from './debate-result.ts'
import { type TurnGroup, turnListModel } from './debate-turn-list.ts'
import type { AuthorModel } from './note-item.ts'
import { type Participants, debateParticipants } from './participants.ts'
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
  const people: Required<RoomPeople> = { nameOf, viewerId, cite: citingTurnsOf(debate) }
  const agentOf = (agent: string, memberId: MemberId): string =>
    memberId === viewerId
      ? strings.debates.mine.agentOf({ agent })
      : strings.debates.agentOf({ agent, person: nameOf(memberId) })
  const result =
    stage === 'awaiting-result' || stage === 'voting' || stage === 'closed'
      ? resultModel(debate, stage, people)
      : null
  const voteRecord = result?.kind === 'settled' ? result.voteRecord : null
  const credit = creditModel(debate, people)
  const available = DEBATE_TABS.filter((tab) =>
    tab === 'result'
      ? result !== null || stage === 'ended'
      : tab === 'votes'
        ? stage === 'voting' || voteRecord !== null
        : tab === 'credit'
          ? credit !== null
          : true,
  )
  const focusTurn = debate.turns.find((turn) => turn.position === input.turn)?.position ?? null
  const shown =
    input.tab !== null && available.includes(input.tab)
      ? input.tab
      : available.includes('result')
        ? 'result'
        : 'turns'
  const turns = turnListModel(debate.turns, {
    viewerId,
    changedPositions: creditedChanges(debate),
    now: input.now,
    focus: focusTurn,
    agentOf,
    cite: people.cite,
    details: (turn) =>
      debateAuthorModel(input, {
        id: `${debate.id}-turn-${turn.position}`,
        memberId: turn.memberId,
        agentName: turn.agentName,
        agentModel: turn.agentModel,
      }),
  })
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
    focusesTab: input.tab !== null && focusTurn === null,
    focusTurn: shown === 'turns' ? focusTurn : null,
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
    people: debateParticipants(debate, viewerId, nameOf),
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
      ready:
        debate.status === 'open' && isReadyToConclude(debate, participant.memberId)
          ? strings.debates.readyToConclude
          : null,
    })),
    readyHint: debate.status === 'open' && debate.turns.length > 0 ? strings.debates.readyHint : null,
    agreedEarly:
      debate.concludedBecause === 'agreed'
        ? strings.debates.agreedEarly({ count: debate.turns.length, total: debate.limits.totalTurns })
        : null,
    optIn: mayOptIn(debate, viewerId)
      ? input.agents.length === 0
        ? { kind: 'no-agent', text: strings.debates.noAgent }
        : {
            kind: 'choose',
            agents: input.agents.map((agent) => ({ value: agent.id, label: agent.name })),
            brief: briefField(''),
          }
      : null,
    brief: briefOf(debate, viewerId),
    turns:
      debate.turns.length === 0
        ? {
            kind: 'none',
            text: stage === 'gathering' ? strings.debates.waitingForSecond : strings.debates.noTurns,
          }
        : {
            kind: 'turns',
            taken: strings.debates.turnsTaken({
              count: debate.turns.length,
              total: debate.limits.totalTurns,
            }),
            timing: strings.debates.turnTimes({
              first: fullTime(debate.turns[0]!.at),
              last: fullTime(debate.turns[debate.turns.length - 1]!.at),
            }),
            groups: turns,
          },
    ended: stage === 'ended' ? strings.debates.ended[debate.endedBecause ?? 'no_turns'] : null,
    result,
    moved: result?.kind === 'settled' ? movesIn(debate, people) : [],
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
            chooseFirst: strings.debates.chooseDestination,
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
  /** A turn the address asks to bring into view, or null. */
  readonly turn?: number | null
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
      /** The turn to bring into view and focus once drawn, when the Turns tab is shown. */
      readonly focusTurn: number | null
      readonly question: string
      readonly stage: DebateStage
      readonly stageText: string
      readonly isPrivate: boolean
      readonly closesAt: string | null
      readonly limits: string
      readonly grace: string
      readonly mayChangeLimits: boolean
      readonly limitsFixed: boolean
      /** Who takes part, listed behind a count beside the room's stage. */
      readonly people: Participants
      readonly participants: ReadonlyArray<{
        readonly memberId: MemberId
        readonly name: string
        readonly turnsLeft: string | null
        readonly droppedOut: string | null
        /** While the room takes turns: that the agent is ready to conclude. */
        readonly ready: string | null
      }>
      /** While the room takes turns: when an agent counts as ready, and what follows. */
      readonly readyHint: string | null
      /** Why the room stopped taking turns before they ran out. */
      readonly agreedEarly: string | null
      readonly optIn:
        | { readonly kind: 'no-agent'; readonly text: string }
        | {
            readonly kind: 'choose'
            readonly agents: ReadonlyArray<{ readonly value: string; readonly label: string }>
            /** The person's note on what their agent may use here, written with the opt-in. */
            readonly brief: BriefField
          }
        | null
      /** To a participant: their own note on what their agent may use here, editable while turns go on. */
      readonly brief: BriefModel | null
      readonly turns:
        | { readonly kind: 'none'; readonly text: string }
        | {
            readonly kind: 'turns'
            readonly taken: string
            readonly timing: string
            readonly groups: ReadonlyArray<TurnGroup>
          }
      readonly ended: string | null
      readonly result: ResultModel | null
      /** Who changed position during the debate, between which turns, as their turns say. */
      readonly moved: ReadonlyArray<Moved>
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
        /** What to say when the person asks for a draft before choosing where it goes. */
        readonly chooseFirst: string
      } | null
      readonly votes: {
        /** Until when the agents vote, and how many have, while the vote runs. */
        readonly voting: string | null
        readonly record: Extract<ResultModel, { kind: 'settled' }>['voteRecord']
      }
      readonly credit: CreditModel | null
    }

/** The note's text box: its words, its limit and what it is for. */
export interface BriefField {
  readonly label: string
  readonly hint: string
  readonly placeholder: string
  readonly value: string
  readonly maxLength: number
}

export type BriefModel =
  | { readonly kind: 'editable'; readonly title: string; readonly field: BriefField; readonly save: string }
  | { readonly kind: 'fixed'; readonly title: string; readonly text: string; readonly fixed: string }

export interface Moved {
  readonly memberId: MemberId
  readonly text: CitedText
  readonly from: QuotedTurn
  readonly to: QuotedTurn
}

/** Text with each turn it cites linked to that turn on the room's Turns tab. */
const citingTurnsOf =
  (debate: AsRead.Debate) =>
  (text: string): CitedText =>
    citedTurns(text, debate.turns.length).map((part) =>
      part.kind === 'turn'
        ? {
            kind: 'turn',
            text: part.text,
            href: hrefFor({ name: 'debate', id: debate.id, tab: 'turns', turn: part.position }),
          }
        : part,
    )

const movesIn = (
  debate: AsRead.Debate,
  { nameOf, viewerId, cite }: Required<RoomPeople>,
): ReadonlyArray<Moved> =>
  debate.participants.flatMap(({ memberId }) => {
    const move = positionMoveIn(debate, memberId)
    if (move === null) return []
    const agent =
      memberId === viewerId
        ? strings.debates.mine.agent
        : strings.debates.personAgent({ person: nameOf(memberId) })
    return [
      {
        memberId,
        text: cite(strings.debates.movedLine({ agent, from: move.from.position, to: move.to.position })),
        from: turnQuoted(move.from),
        to: turnQuoted(move.to),
      },
    ]
  })

const briefField = (value: string): BriefField => ({
  label: strings.debates.briefTitle,
  hint: strings.debates.briefHint,
  placeholder: strings.debates.briefPlaceholder,
  value,
  maxLength: DEBATE_BRIEF_MAX,
})

/** Only the viewer's own note is ever in the room the server sends, so only a participant sees one. */
const briefOf = (debate: AsRead.Debate, viewerId: MemberId): BriefModel | null => {
  if (!debate.participants.some((participant) => participant.memberId === viewerId)) return null
  const text = debate.brief ?? ''
  return debate.status === 'open'
    ? {
        kind: 'editable',
        title: strings.debates.briefTitle,
        field: briefField(text),
        save: strings.debates.saveBrief,
      }
    : {
        kind: 'fixed',
        title: strings.debates.briefTitle,
        text: text === '' ? strings.debates.briefNone : text,
        fixed: strings.debates.briefFixed,
      }
}

const fullTime = (timestamp: number): string => formats.full.format(new Date(timestamp))

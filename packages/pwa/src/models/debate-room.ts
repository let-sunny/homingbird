import type { AsRead, MemberId } from '@homingbird/protocol'
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
import { formats, strings } from '../strings.ts'
import { debateAuthorModel } from './debate-author.ts'
import { type ResultBody, type ResultModel, resultBody, resultModel } from './debate-result.ts'
import type { AuthorModel } from './note-item.ts'
import { type TimeShown, timeShown } from './time.ts'

/** One debate room: its question, its agents and turns, the result the agents settled, and what to do next. */
export const debateRoomModel = (input: DebateRoomInput): DebateRoomModel => {
  const { debate, viewerId } = input
  if (debate === null) return { kind: 'loading' }
  if (debate === 'missing') return { kind: 'missing', text: strings.debates.notFound }
  const stage = debateStage(debate)
  const nameOf = (id: MemberId): string => input.members.get(id)?.name ?? strings.formerMember
  return {
    kind: 'room',
    debate,
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
      name: strings.debates.agentOf({ agent: participant.agentName, person: nameOf(participant.memberId) }),
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
      debate.turns.length === 0
        ? {
            kind: 'none',
            text: stage === 'gathering' ? strings.debates.waitingForSecond : strings.debates.noTurns,
          }
        : {
            kind: 'turns',
            turns: debate.turns.map((turn) => ({
              position: turn.position,
              mine: turn.memberId === viewerId,
              author: strings.debates.agentOf({ agent: turn.agentName, person: nameOf(turn.memberId) }),
              details: debateAuthorModel(input, {
                id: `${debate.id}-turn-${turn.position}`,
                memberId: turn.memberId,
                agentName: turn.agentName,
                agentModel: turn.agentModel,
              }),
              time: timeShown(turn.at, input.now),
              body: turn.body,
            })),
          },
    ended: stage === 'ended' ? strings.debates.ended[debate.endedBecause ?? 'no_turns'] : null,
    result:
      stage === 'awaiting-result' || stage === 'voting' || stage === 'closed'
        ? resultModel(debate, stage, nameOf)
        : null,
    drafts:
      (debate.drafts ?? []).length === 0
        ? null
        : draftsOf(debate).map(({ draft, chosen }) => ({
            memberId: draft.draftedBy,
            chosen,
            title: strings.debates.draftOf({ person: nameOf(draft.draftedBy) }),
            details: debateAuthorModel(input, {
              id: `${debate.id}-draft-${draft.draftedBy}`,
              memberId: draft.draftedBy,
              agentName:
                debate.participants.find((one) => one.memberId === draft.draftedBy)?.agentName ?? null,
              agentModel: draft.agentModel,
            }),
            votes: draft.votes === null ? null : strings.debates.votes({ count: draft.votes }),
            time: timeShown(draft.draftedAt, input.now),
            body: resultBody(draft.result, nameOf),
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
            readonly turns: ReadonlyArray<{
              readonly position: number
              readonly mine: boolean
              readonly author: string
              readonly details: AuthorModel
              readonly time: TimeShown
              readonly body: string
            }>
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
    }

const fullTime = (timestamp: number): string => formats.full.format(new Date(timestamp))

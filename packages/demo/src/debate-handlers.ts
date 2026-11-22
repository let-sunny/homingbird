import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  Conflict,
  DEFAULT_DEBATE_LIMITS,
  type Debate,
  type DebateId,
  type DebateSummary,
  Forbidden,
  Invalid,
  MemberId,
  NotFound,
  debateFilename,
  debateJson,
  debateMarkdown,
  debateResultText,
  exportLabelsIn,
  limitsFor,
  limitsProblem,
} from '@homingbird/protocol'
import { changeRoom, colleagueJoinsLater, debateLater } from './debate-script.ts'
import { type Handlers, found } from './handlers.ts'
import { connectedAgentOf, memberById } from './reads.ts'
import { destinationOf } from './rooms.ts'
import { saveDraft } from './sending.ts'
import type { Records, World } from './world.ts'

/**
 * Debate rooms to open, read and export, the visitor's agent opted in, and a closed room's result put
 * into the visitor's draft. Colleagues' agents and the debate itself are scripted on the world's clock.
 */
export const debateHandlers = (world: World): Handlers => ({
  'debates.list': (_, viewerId) =>
    T.sync(() => ({
      debates: world
        .records()
        .debates.filter((debate) => mayEnter(debate, viewerId))
        .map((debate) => summaryOf(debate, viewerId)),
    })),
  'debates.get': ({ params }, viewerId) => roomOf(world.records(), viewerId, params.id),
  'debates.waiting': () => T.succeed({ asks: [] }),
  'debates.create': ({ body }, viewerId) =>
    T.gen(function* () {
      const question = body.question.trim()
      if (question === '') return yield* T.fail(Invalid({ message: 'A debate room needs a question.' }))
      const limits = limitsFor(body.limits ?? DEFAULT_DEBATE_LIMITS, 0)
      const problem = limitsProblem(limits)
      if (problem !== null) return yield* T.fail(Invalid({ message: problem }))
      const records = world.records()
      const invited = (body.memberIds ?? []).filter(
        (id) => id !== viewerId && memberById(records, id)?.kind === 'person',
      )
      const visibility = body.visibility === 'private' ? 'private' : 'open'
      const now = world.clock.now()
      const debate: Debate = {
        id: world.nextId('deb') as DebateId,
        question,
        visibility,
        status: 'open',
        createdBy: viewerId,
        createdAt: now,
        deadlineAt: now + limits.minutes * 60_000,
        concludedAt: null,
        closedAt: null,
        endedBecause: null,
        limits,
        memberIds: [viewerId, ...invited],
        participants: [],
        turns: [],
        result: null,
        resultRound: 0,
      }
      world.update((current) => ({ ...current, debates: [debate, ...current.debates] }))
      changeRoom(world, debate.id, (room) => room)
      colleagueJoinsLater(
        world,
        debate.id,
        invited[0] ?? (visibility === 'open' ? OPEN_ROOM_COLLEAGUE : null),
      )
      return yield* roomOf(world.records(), viewerId, debate.id)
    }),
  'debates.optIn': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const debate = yield* roomOf(world.records(), viewerId, params.id)
      const agent = connectedAgentOf(world.records(), viewerId, body.agentId)
      if (agent === null) return yield* T.fail(NotFound({ message: 'No such connected agent.' }))
      if (debate.status !== 'open')
        return yield* T.fail(Conflict({ message: 'This room takes no more agents.' }))
      if (debate.participants.some((participant) => participant.memberId === viewerId))
        return yield* T.fail(Conflict({ message: 'Your agent already takes part in this room.' }))
      changeRoom(world, debate.id, (room) => {
        const participants = [
          ...room.participants,
          {
            memberId: viewerId,
            agentId: agent.id,
            agentName: agent.name,
            joinedAt: world.clock.now(),
            takingPart: true,
          },
        ]
        const { totalTurns: _, ...wish } = room.limits
        const follows = room.turns.length === 0 && room.limits.totalFollowsAgents === true
        return {
          ...room,
          memberIds: room.memberIds.includes(viewerId) ? room.memberIds : [...room.memberIds, viewerId],
          participants,
          limits: follows ? limitsFor(wish, participants.length) : room.limits,
        }
      })
      debateLater(world, debate.id)
      return yield* roomOf(world.records(), viewerId, debate.id)
    }),
  'debates.limits.set': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const debate = yield* roomOf(world.records(), viewerId, params.id)
      if (debate.createdBy !== viewerId)
        return yield* T.fail(
          Forbidden({ message: 'Only the person who opened this room can change its limits.' }),
        )
      if (debate.status !== 'open' || debate.turns.length > 0)
        return yield* T.fail(Conflict({ message: 'The limits are fixed once the first turn is taken.' }))
      const limits = limitsFor(body, debate.participants.length)
      const problem = limitsProblem(limits)
      if (problem !== null) return yield* T.fail(Invalid({ message: problem }))
      changeRoom(world, debate.id, (room) => ({
        ...room,
        limits,
        deadlineAt: room.createdAt + limits.minutes * 60_000,
      }))
      return yield* roomOf(world.records(), viewerId, debate.id)
    }),
  'debates.result.post': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const debate = yield* roomOf(world.records(), viewerId, params.id)
      if (debate.status !== 'closed' || debate.result === null)
        return yield* T.fail(Conflict({ message: 'Only a closed room’s settled result leaves the room.' }))
      if (!debate.turns.some((turn) => turn.memberId === viewerId))
        return yield* T.fail(
          Forbidden({ message: 'Only a person whose agent took a turn posts the result.' }),
        )
      const chosen = [body.conversationId, body.to, body.channel].filter((each) => each !== undefined)
      if (chosen.length !== 1)
        return yield* T.fail(
          Invalid({ message: 'Say where the result goes: one conversation, person or channel.' }),
        )
      const room = yield* destinationOf(world, viewerId, {
        ...(body.conversationId !== undefined && { conversationId: body.conversationId }),
        ...(body.to !== undefined && { to: [body.to] }),
        ...(body.channel !== undefined && { channel: body.channel }),
      })
      const nameOf = nameIn(world.records())
      return saveDraft(world, {
        conversationId: room.id,
        authorId: viewerId,
        body: debateResultText(debate, debate.result.result, nameOf),
        inReplyTo: null,
        agentName: null,
        basis: null,
        fromDebate: {
          debateId: debate.id,
          question: debate.question,
          agents: debate.participants.map((one) => ({ agent: one.agentName, person: nameOf(one.memberId) })),
        },
      })
    }),
  'debates.export': ({ params, body }, viewerId) =>
    T.map((debate: Debate) => {
      const nameOf = nameIn(world.records())
      return body.format === 'json'
        ? {
            filename: debateFilename(debate, 'json'),
            mediaType: 'application/json' as const,
            text: debateJson(debate, nameOf),
          }
        : {
            filename: debateFilename(debate, 'md'),
            mediaType: 'text/markdown' as const,
            text: debateMarkdown(debate, nameOf, exportLabelsIn(body.language ?? null)),
          }
    })(roomOf(world.records(), viewerId, params.id)),
})

/** Whose agent joins an open room the visitor opened without inviting anyone. */
const OPEN_ROOM_COLLEAGUE = MemberId.of('demoana00000')

const nameIn =
  (records: Records) =>
  (id: MemberId): string =>
    memberById(records, id)?.name ?? 'A former member'

const mayEnter = (debate: Debate, viewerId: MemberId): boolean =>
  debate.visibility === 'open' || debate.memberIds.includes(viewerId)

/** A room as one member reads it: which of the agents is theirs is shown to them only. */
const roomOf = (records: Records, viewerId: MemberId, id: string): T.Task<Debate, ApiError> =>
  T.map((debate: Debate) => ({
    ...debate,
    participants: debate.participants.map((participant) =>
      participant.memberId === viewerId ? participant : { ...participant, agentId: null },
    ),
  }))(
    found(
      records.debates.find((debate) => debate.id === id && mayEnter(debate, viewerId)),
      'No such debate room.',
    ),
  )

const summaryOf = (debate: Debate, viewerId: MemberId): DebateSummary => ({
  id: debate.id,
  question: debate.question,
  visibility: debate.visibility,
  status: debate.status,
  createdBy: debate.createdBy,
  createdAt: debate.createdAt,
  deadlineAt: debate.deadlineAt,
  participantIds: debate.participants.map((participant) => participant.memberId),
  turnCount: debate.turns.length,
  totalTurns: debate.limits.totalTurns,
  resultDrafted: debate.result !== null,
  joined:
    debate.memberIds.includes(viewerId) ||
    debate.participants.some((participant) => participant.memberId === viewerId),
})

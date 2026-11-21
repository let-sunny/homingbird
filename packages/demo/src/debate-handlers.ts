import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  Conflict,
  type Debate,
  type DebateSummary,
  Forbidden,
  Invalid,
  type MemberId,
  debateFilename,
  debateJson,
  debateMarkdown,
  debateResultText,
  exportLabelsIn,
} from '@homingbird/protocol'
import { type Handlers, found } from './handlers.ts'
import { memberById } from './reads.ts'
import { destinationOf } from './rooms.ts'
import { saveDraft } from './sending.ts'
import type { Records, World } from './world.ts'

/** Debate rooms to read and export, and a closed room's result put into the visitor's draft; opening a room and taking part stay with a real server. */
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
      return saveDraft(world, {
        conversationId: room.id,
        authorId: viewerId,
        body: debateResultText(debate, debate.result.result, nameIn(world.records())),
        inReplyTo: null,
        agentName: null,
        basis: null,
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

import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type Debate,
  type DebateSummary,
  type MemberId,
  debateFilename,
  debateJson,
  debateMarkdown,
  exportLabelsIn,
} from '@homingbird/protocol'
import { type Handlers, found } from './handlers.ts'
import { memberById } from './reads.ts'
import type { Records, World } from './world.ts'

/** Debate rooms to read and export; opening a room, taking part and posting its result stay with a real server. */
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
  'debates.export': ({ params, body }, viewerId) =>
    T.map((debate: Debate) => {
      const nameOf = (id: MemberId) => memberById(world.records(), id)?.name ?? id
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
  resultDrafted: debate.result !== null,
  joined: debate.participants.some((participant) => participant.memberId === viewerId),
})

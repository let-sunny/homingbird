import { Task as T } from '@homingbird/kernel'
import {
  type Conflict,
  type CredentialId,
  type Debate,
  type DebateId,
  Forbidden,
  type Invalid,
  type NotFound,
} from '@homingbird/protocol'
import { type AppEnv, type Caller, isHuman, viewerOf } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { describeDebate, lockedDebate, participantByAgent, visibleDebate } from './debate-rows.ts'
import { moveDebate, settleDebateRow } from './debate-settling.ts'

/** Only the credential its person opted in may take a turn; a reached limit stops the room at once. */
export const takeTurn = (
  caller: Caller,
  id: DebateId,
  body: string,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    yield* visibleDebate(viewerOf(caller), id)
    if (isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Turns are taken by agents; a person opts their agent in.' }))
    const participant = yield* participantByAgent(id, caller.credential.id)
    if (participant === null)
      return yield* T.fail(Forbidden({ message: 'Your person has not opted this agent in for this room.' }))
    yield* moveDebate(
      yield* lockedDebate(id),
      { type: 'turn', memberId: participant.member_id, body },
      { credentialId: caller.credential.id, agentName: participant.agent_name },
    )
    return yield* describeDebate(yield* lockedDebate(id))
  })

/** The rooms to move on, by id, each in a transaction of its own: all, or those an agent was opted in for. */
export const undecidedDebates = (
  credentialId: CredentialId | null = null,
): T.Task<ReadonlyArray<DebateId>, never, AppEnv> =>
  T.map((rows: ReadonlyArray<{ id: DebateId }>) => rows.map((row) => row.id))(
    all<{ id: DebateId }>(
      credentialId === null
        ? sql`SELECT id FROM debates WHERE status IN ('open', 'concluding') ORDER BY id`
        : sql`SELECT d.id FROM debates d JOIN debate_participants p ON p.debate_id = d.id
          WHERE p.credential_id = ${credentialId} AND d.status IN ('open', 'concluding') ORDER BY d.id`,
    ),
  )

/** Locks the room and moves it on: a result it can settle comes before the day-long limit. */
export const settleDebate = (id: DebateId): T.Task<void, never, RequestEnv> =>
  T.flatMap(settleDebateRow)(lockedDebate(id))

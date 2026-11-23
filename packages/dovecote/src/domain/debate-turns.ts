import { Task as T } from '@homingbird/kernel'
import {
  type Conflict,
  type CredentialId,
  type Debate,
  type DebateId,
  Forbidden,
  type Invalid,
  type NotFound,
  turnHoldOf,
} from '@homingbird/protocol'
import { type AppEnv, type Caller, isHuman, viewerOf } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import {
  describeDebate,
  loadRoom,
  lockedDebate,
  participantByAgent,
  roomRulesOf,
  visibleDebate,
} from './debate-rows.ts'
import { moveDebate, settleDebateRow } from './debate-settling.ts'

/** Only the opted-in credential takes a turn; a turn refused for its length or as stale keeps its place. */
export const takeTurn = (
  caller: Caller,
  id: DebateId,
  wish: TurnWish,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* visibleDebate(viewerOf(caller), id)
    if (isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Turns are taken by agents; a person opts their agent in.' }))
    const participant = yield* participantByAgent(id, caller.credential.id)
    if (participant === null)
      return yield* T.fail(Forbidden({ message: 'Your person has not opted this agent in for this flock.' }))
    const row = yield* lockedDebate(id)
    const event = {
      type: 'turn' as const,
      memberId: participant.member_id,
      body: wish.body,
      ...(wish.afterTurn !== undefined && { afterTurn: wish.afterTurn }),
      ...(wish.ready === true && { ready: true }),
    }
    const hold = turnHoldOf((yield* loadRoom(row)).room, event, env.clock.now(), roomRulesOf(row))
    if (hold !== null) env.turnHolds.keep(id, hold)
    yield* moveDebate(row, event, {
      credentialId: caller.credential.id,
      agentName: participant.agent_name,
      model: wish.model,
    })
    return yield* describeDebate(yield* lockedDebate(id))
  })

export interface TurnWish {
  readonly body: string
  readonly model?: string | undefined
  readonly afterTurn?: number | undefined
  readonly ready?: boolean | undefined
}

/** The flocks to move on, by id, each in a transaction of its own: all, or those an agent was opted in for. */
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

/** Locks the flock and moves it on: a result it can settle comes before the day-long limit. */
export const settleDebate = (id: DebateId): T.Task<void, never, RequestEnv> =>
  T.flatMap(settleDebateRow)(lockedDebate(id))

import { Task as T } from '@homingbird/kernel'
import { type Conflict, type Invalid, type MemberId, mayJoinByDelegation } from '@homingbird/protocol'
import type { RequestEnv } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import { type DebateRow, lockedDebate } from './debate-rows.ts'
import { moveDebate } from './debate-settling.ts'
import { delegatedAgentOf, delegationOf } from './scheduling-delegations.ts'

/** Without the person's click, recorded and told to them, naming the agent the first time. */
export const joinByDelegation = (
  row: DebateRow,
  memberId: MemberId,
  minutes: number,
): T.Task<void, Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const delegation = yield* delegationOf(memberId)
    if (!mayJoinByDelegation(delegation, { memberId, openedBy: row.created_by, minutes })) return
    const agent = yield* delegatedAgentOf(memberId, delegation.agentId)
    if (agent === null) return
    const isFirst =
      (yield* first(
        sql`SELECT 1 AS present FROM scheduling_attendees WHERE member_id = ${memberId} AND by_delegation = 1`,
      )) === null
    yield* moveDebate(
      yield* lockedDebate(row.id),
      { type: 'join', memberId },
      { credentialId: agent.id, agentName: agent.name },
    )
    const brief = delegation.brief.trim()
    if (brief !== '')
      yield* run(sql`
        UPDATE debate_participants SET brief = ${brief} WHERE debate_id = ${row.id} AND member_id = ${memberId}`)
    yield* run(sql`
      UPDATE scheduling_attendees SET by_delegation = 1 WHERE debate_id = ${row.id} AND member_id = ${memberId}`)
    yield* recordAudit('debate.agent_opted_in', {
      actorId: memberId,
      targetId: row.id,
      detail: { credentialId: agent.id, byDelegation: true },
    })
    env.outbox.push({
      memberId,
      meeting: {
        debateId: row.id,
        title: row.question,
        toOpener: memberId === row.created_by,
        notice: { to: memberId, notice: 'joined', agentName: isFirst ? agent.name : null },
      },
    })
  })

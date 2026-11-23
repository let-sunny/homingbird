import { Task as T, isOk } from '@homingbird/kernel'
import {
  ALREADY_DRAFTED,
  ALREADY_VOTED,
  Conflict,
  type CredentialId,
  DEFAULT_GRACE_MINUTES,
  type DebateActionEffect,
  type DebateEvent,
  type DebateSettlingEffect,
  type Invalid,
  settleDebateRoom,
  stepDebate,
} from '@homingbird/protocol'
import type { RequestEnv } from '../events/events.ts'
import { dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import {
  type DebateRow,
  announceDebate,
  enterDebate,
  loadRoom,
  roomRulesOf,
  touchDebate,
} from './debate-rows.ts'
import { confirmMeeting } from './meeting-invitations.ts'
import { keepAgentSlots } from './scheduling-rows.ts'

/**
 * Moves the room the row was read as on by what time alone decides, storing each effect the machine
 * chose with an update that matches the stage it was decided on: a room changed since stays as it is.
 */
export const settleDebateRow = (row: DebateRow): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const { room } = yield* loadRoom(row)
    for (const effect of settleDebateRoom(room, env.clock.now(), roomRulesOf(row)).effects)
      yield* applySettling(row, effect)
  })

/**
 * Takes an agent's or a person's event in the room, after settling what time decided; a refused event
 * stores nothing. A turn or limits that stop the room are announced by the stop alone.
 */
export const moveDebate = (
  row: DebateRow,
  event: DebateEvent,
  actor?: DebateActor,
): T.Task<void, Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const { room } = yield* loadRoom(row)
    const move = stepDebate(room, event, env.clock.now(), roomRulesOf(row))
    if (!isOk(move)) return yield* T.fail(move.error)
    for (const effect of move.value.before) yield* applySettling(row, effect)
    yield* applyAction(row, move.value.action, actor)
    if (move.value.after.length === 0 || event.type === 'draft' || event.type === 'vote')
      yield* announceDebate(row)
    for (const effect of move.value.after) yield* applySettling(row, effect)
  })

/** The agent an event comes from: the credential its person opted in, or is opting in. */
export interface DebateActor {
  readonly credentialId: CredentialId
  readonly agentName: string
  /** The model the agent said it ran as, for a turn, a draft or a vote. */
  readonly model?: string | undefined
}

/** Stores one way the room moved on, then audits and announces it, only when the update changed the room. */
export const applySettling = (
  row: DebateRow,
  effect: DebateSettlingEffect,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    switch (effect.type) {
      case 'conclude': {
        const concluded = yield* run(sql`
          UPDATE debates SET status = 'concluding', concluded_at = ${now}, concluded_because = ${effect.because},
          updated_at = ${now}
          WHERE id = ${row.id} AND status = 'open'`)
        if (concluded !== 1) return
        yield* recordAudit('debate.concluded', { targetId: row.id, detail: { because: effect.because } })
        return yield* announceDebate(row)
      }
      case 'openVote': {
        const opened = yield* run(sql`
          UPDATE debates SET votes_open_at = ${now}, updated_at = ${now}
          WHERE id = ${row.id} AND status = 'concluding' AND result IS NULL AND votes_open_at IS NULL
          AND result_round = ${effect.round}`)
        if (opened === 1) yield* announceDebate(row)
        return
      }
      case 'close':
        return yield* close(row, effect, now)
      case 'closeComputed':
        return yield* closeComputed(row, effect, now)
      case 'end': {
        const ended = yield* run(endingUpdate(row, effect, now))
        if (ended !== 1) return
        yield* recordAudit('debate.ended', { targetId: row.id, detail: { because: effect.because } })
        return yield* announceDebate(row, 'everyone')
      }
    }
  })

const applyAction = (
  row: DebateRow,
  effect: DebateActionEffect,
  actor: DebateActor | undefined,
): T.Task<void, Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    switch (effect.type) {
      case 'addParticipant':
        yield* enterDebate(row.id, effect.memberId, now)
        yield* run(
          insertInto('debate_participants', {
            debate_id: row.id,
            member_id: effect.memberId,
            credential_id: actor!.credentialId,
            agent_name: actor!.agentName,
            created_at: now,
          }),
        )
        if (effect.totalTurns !== null)
          yield* run(sql`UPDATE debates SET total_turns = ${effect.totalTurns} WHERE id = ${row.id}`)
        return yield* touchDebate(row.id, now)
      case 'changeLimits':
        return yield* T.asUnit(
          run(sql`
            UPDATE debates SET turns_per_agent = ${effect.limits.turnsPerAgent}, total_turns = ${effect.limits.totalTurns},
            minutes = ${effect.limits.minutes}, turn_characters = ${effect.limits.turnCharacters},
            total_follows_agents = ${effect.limits.totalFollowsAgents === true ? 1 : null},
            deadline_at = ${effect.deadlineAt},
            grace_minutes = ${effect.limits.graceMinutes ?? DEFAULT_GRACE_MINUTES}, updated_at = ${now}
            WHERE id = ${row.id}`),
        )
      case 'addTurn': {
        const taken = yield* run(
          insertIgnoringConflict(yield* dialect, 'debate_turns', {
            debate_id: row.id,
            position: effect.position,
            member_id: effect.memberId,
            credential_id: actor!.credentialId,
            agent_name: actor!.agentName,
            body: effect.body,
            created_at: now,
            ...statedModelOf(actor!),
            ...(effect.afterTurn !== null && { after_turn: effect.afterTurn }),
            ...(effect.ready && { ready: 1 }),
          }),
        )
        if (taken !== 1)
          return yield* T.fail(
            Conflict({ message: 'Another turn was taken at the same moment. Read the room again.' }),
          )
        if (effect.deadlineAt !== null)
          yield* run(sql`UPDATE debates SET deadline_at = ${effect.deadlineAt} WHERE id = ${row.id}`)
        if (effect.slots !== undefined) yield* keepAgentSlots(row.id, effect.memberId, effect.slots, now)
        return yield* touchDebate(row.id, now)
      }
      case 'addDraft': {
        const saved = yield* run(
          insertIgnoringConflict(yield* dialect, 'debate_drafts', {
            debate_id: row.id,
            round: effect.round,
            member_id: effect.memberId,
            credential_id: actor!.credentialId,
            result: JSON.stringify(effect.result),
            created_at: now,
            ...statedModelOf(actor!),
          }),
        )
        if (saved !== 1) return yield* T.fail(Conflict({ message: ALREADY_DRAFTED }))
        return
      }
      case 'addVote': {
        const cast = yield* run(
          insertIgnoringConflict(yield* dialect, 'debate_votes', {
            debate_id: row.id,
            round: effect.round,
            voter_id: effect.voterId,
            draft_by: effect.draftBy,
            created_at: now,
            ...statedModelOf(actor!),
          }),
        )
        if (cast !== 1) return yield* T.fail(Conflict({ message: ALREADY_VOTED }))
        return
      }
    }
  })

/** The stated model's column, written only when the agent stated one. */
const statedModelOf = (actor: DebateActor): { agent_model?: string } =>
  actor.model === undefined ? {} : { agent_model: actor.model.trim() }

/** Closes the room on the result it was read with; a room whose round or result changed since stays. */
const close = (
  row: DebateRow,
  effect: Extract<DebateSettlingEffect, { readonly type: 'close' }>,
  now: number,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const { chosen } = effect
    const unchanged = effect.replacing === null ? sql`result IS NULL` : sql`result_at = ${effect.replacing}`
    const closed = yield* run(sql`
      UPDATE debates SET status = 'closed', result = ${JSON.stringify(chosen.result)}, result_by = ${chosen.draftedBy},
      result_at = ${chosen.draftedAt}, dropped_out = ${JSON.stringify(effect.droppedOut)}, closed_at = ${now},
      updated_at = ${now}
      WHERE id = ${row.id} AND status = 'concluding' AND result_round = ${effect.round} AND ${unchanged}`)
    if (closed !== 1) return
    for (const { memberId, credit } of effect.credits)
      yield* run(
        insertInto('debate_credits', {
          debate_id: row.id,
          member_id: memberId,
          kind: credit,
          created_at: now,
        }),
      )
    yield* recordAudit('debate.closed', {
      targetId: row.id,
      detail: {
        round: effect.round,
        draftedBy: chosen.draftedBy,
        votes: effect.votes,
        drafts: effect.drafts,
        droppedOut: effect.droppedOut,
      },
    })
    yield* announceDebate(row, 'everyone')
  })

/**
 * Closes a scheduling room on the time it computed, which nobody drafted and earns no credits; the time is
 * kept and the meeting started for the invitation, and the audit says only how it settled and how many
 * answered.
 */
const closeComputed = (
  row: DebateRow,
  effect: Extract<DebateSettlingEffect, { readonly type: 'closeComputed' }>,
  now: number,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const { result, draftedAt } = effect.chosen
    const closed = yield* run(sql`
      UPDATE debates SET status = 'closed', result = ${JSON.stringify(result)}, result_by = NULL,
      result_at = ${draftedAt}, dropped_out = ${JSON.stringify(effect.droppedOut)}, closed_at = ${now},
      updated_at = ${now}
      WHERE id = ${row.id} AND status = 'concluding' AND result_round = ${effect.round} AND result IS NULL`)
    if (closed !== 1) return
    if (result.kind === 'slot') {
      yield* run(
        sql`UPDATE scheduling_rooms SET slot_starts_at = ${result.startsAt} WHERE debate_id = ${row.id}`,
      )
      yield* confirmMeeting(row, result)
    }
    const asked = yield* first<{ attendees: number }>(
      sql`SELECT COUNT(*) AS attendees FROM scheduling_attendees WHERE debate_id = ${row.id}`,
    )
    const unanswered = 'unanswered' in result ? result.unanswered.length : 0
    yield* recordAudit('debate.settled', {
      targetId: row.id,
      detail: {
        outcome: result.kind,
        answered: Number(asked?.attendees ?? 0) - unanswered,
        unanswered,
        droppedOut: effect.droppedOut,
      },
    })
    yield* announceDebate(row, 'everyone')
  })

/** A room ends from taking turns, or while it decides its result: with no result, or with its agents gone. */
const endingUpdate = (
  row: DebateRow,
  effect: Extract<DebateSettlingEffect, { readonly type: 'end' }>,
  now: number,
) => {
  if (effect.during === 'turns')
    return sql`UPDATE debates SET status = 'ended', ended_because = ${effect.because}, concluded_at = ${now},
      closed_at = ${now}, updated_at = ${now} WHERE id = ${row.id} AND status = 'open'`
  if (effect.because === 'no_result')
    return sql`UPDATE debates SET status = 'ended', ended_because = 'no_result', closed_at = ${now}, updated_at = ${now}
      WHERE id = ${row.id} AND status = 'concluding'`
  return sql`UPDATE debates SET status = 'ended', ended_because = ${effect.because}, closed_at = ${now}, updated_at = ${now}
    WHERE id = ${row.id} AND status = 'concluding' AND result IS NULL`
}

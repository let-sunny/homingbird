import { Task as T } from '@homingbird/kernel'
import {
  ChannelSources,
  type ChannelTeaching,
  type ConversationId,
  type DraftingPrinciples,
  FEATURE_OFF_MESSAGE,
  Invalid,
  type MemberId,
  NotFound,
  PRINCIPLES_PER_PERSON,
  type Principle,
  type PrincipleKind,
  type TaughtFrom,
  channelInstructionMessage,
  channelInstructionProblem,
  selectChannelTeaching,
  selectPrinciples,
} from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { type AgentFailure, agentsChannel, managedAgent } from './channel-agents.ts'
import type { ChannelRow } from './channel-rows.ts'
import { participatedConversation } from './conversations.ts'
import { principlesOf, shownWith } from './principle-rows.ts'
import { createPrinciple, deletePrinciple, orderPrinciples, updatePrinciple } from './principles.ts'
import { featureIsOn } from './settings.ts'

/**
 * What a channel's managers taught its agent. Its principles are the agent's own, kept as a person's
 * are under the agent's member id; only a current manager of the channel reads or changes them, in the
 * web client, and an administrator outside the managing group gets the same refusal as anyone else.
 */
export const channelTeachingFor = (
  caller: Caller,
  slug: string,
): T.Task<ChannelTeaching, TeachingFailure, RequestEnv> =>
  T.gen(function* () {
    const { row, agent } = yield* taughtAgent(caller, slug)
    return yield* teachingOf(row, agent.id)
  })

export const setChannelTeaching = (
  caller: Caller,
  slug: string,
  brief: { readonly instruction: string; readonly sources: ReadonlyArray<string> },
): T.Task<ChannelTeaching, TeachingFailure | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const { row, agent } = yield* taughtAgent(caller, slug)
    const instruction = brief.instruction.trim()
    const problem = channelInstructionProblem({ instruction, sources: brief.sources })
    if (problem !== null) return yield* T.fail(Invalid({ message: channelInstructionMessage(problem) }))
    const now = env.clock.now()
    const sources = JSON.stringify(brief.sources)
    const changed = yield* run(sql`UPDATE channel_agent_teaching
      SET instruction = ${instruction}, sources = ${sources}, updated_at = ${now} WHERE agent_id = ${agent.id}`)
    if (changed === 0)
      yield* run(
        insertInto('channel_agent_teaching', { agent_id: agent.id, instruction, sources, updated_at: now }),
      )
    return yield* teachingOf(row, agent.id)
  })

export const createChannelPrinciple = (
  caller: Caller,
  slug: string,
  draft: {
    readonly kind?: PrincipleKind | undefined
    readonly topic: string
    readonly rule: string
    readonly source?: string | null | undefined
    readonly taughtFrom?: TaughtFrom | undefined
  },
): T.Task<Principle, TeachingFailure | Invalid, RequestEnv> =>
  T.gen(function* () {
    const { agent } = yield* taughtAgent(caller, slug)
    return yield* createPrinciple(agent.id, {
      kind: draft.kind,
      topic: draft.topic,
      rule: draft.rule,
      source: draft.source,
      place: null,
      taughtFrom: draft.taughtFrom,
    })
  })

export const updateChannelPrinciple = (
  caller: Caller,
  slug: string,
  id: string,
  change: {
    readonly kind?: PrincipleKind | undefined
    readonly topic?: string | undefined
    readonly rule?: string | undefined
    readonly source?: string | null | undefined
    readonly enabled?: boolean | undefined
  },
): T.Task<Principle, TeachingFailure | Invalid, RequestEnv> =>
  T.gen(function* () {
    const { agent } = yield* taughtAgent(caller, slug)
    return yield* updatePrinciple(agent.id, id, change)
  })

export const reorderChannelPrinciples = (
  caller: Caller,
  slug: string,
  ids: ReadonlyArray<string>,
): T.Task<ChannelTeaching, TeachingFailure | Invalid, RequestEnv> =>
  T.gen(function* () {
    const { row, agent } = yield* taughtAgent(caller, slug)
    yield* orderPrinciples(agent.id, ids)
    return yield* teachingOf(row, agent.id)
  })

export const deleteChannelPrinciple = (
  caller: Caller,
  slug: string,
  id: string,
): T.Task<Principle, TeachingFailure, RequestEnv> =>
  T.gen(function* () {
    const { agent } = yield* taughtAgent(caller, slug)
    return yield* deletePrinciple(agent.id, id)
  })

/**
 * What a channel's agent drafts with, read by its own credential through `principles.drafting`: its
 * channel's instruction, sources and principles. It answers only in its channel, so no principle is
 * put first for a place.
 */
export const channelTeachingForDrafting = (
  agentId: MemberId,
  conversationId: ConversationId | undefined,
): T.Task<DraftingPrinciples, Invalid, RequestEnv> =>
  T.gen(function* () {
    if (conversationId !== undefined)
      yield* T.catchTag('NotFound', () => T.fail(Invalid({ message: NOT_IN_CONVERSATION })))(
        participatedConversation(agentId, conversationId),
      )
    const row = yield* agentsChannel(agentId)
    const principles = yield* principlesOf(agentId)
    if (row === null) return selectPrinciples(principles)
    const { instruction, sources } = yield* briefOf(agentId)
    return selectChannelTeaching({ channel: row.slug, instruction, sources }, principles)
  })

export type TeachingFailure = AgentFailure

const NOT_IN_CONVERSATION =
  'Your agent is not in that conversation, so there are no principles to give for it.'

/** A manager's agent, refused as a switched-off feature when the organization turned teaching off. */
const taughtAgent = (caller: Caller, slug: string) =>
  T.gen(function* () {
    if (!(yield* featureIsOn('teaching'))) return yield* T.fail(NotFound({ message: FEATURE_OFF_MESSAGE }))
    return yield* managedAgent(caller, slug)
  })

const teachingOf = (row: ChannelRow, agentId: MemberId): T.Task<ChannelTeaching, never, AppEnv> =>
  T.gen(function* () {
    const figures = yield* featureIsOn('agentFigures')
    const brief = yield* briefOf(agentId)
    return {
      channel: row.slug,
      ...brief,
      principles: (yield* principlesOf(agentId)).map((principle) => shownWith(principle, figures)),
      limit: PRINCIPLES_PER_PERSON,
    }
  })

const briefOf = (
  agentId: MemberId,
): T.Task<
  { readonly instruction: string; readonly sources: string[]; readonly updatedAt: number | null },
  never,
  AppEnv
> =>
  T.map((found: TeachingRow | null) => {
    if (found === null) return { instruction: '', sources: [], updatedAt: null }
    const sources = ChannelSources.decode(JSON.parse(found.sources))
    return {
      instruction: found.instruction,
      sources: sources._tag === 'Ok' ? [...sources.value] : [],
      updatedAt: Number(found.updated_at),
    }
  })(first<TeachingRow>(sql`SELECT * FROM channel_agent_teaching WHERE agent_id = ${agentId}`))

interface TeachingRow {
  readonly agent_id: MemberId
  readonly instruction: string
  readonly sources: string
  readonly updated_at: number
}

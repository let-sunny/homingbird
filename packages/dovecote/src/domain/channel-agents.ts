import { Task as T } from '@homingbird/kernel'
import {
  type AgentCredential,
  type ChannelAgent,
  Conflict,
  type CredentialId,
  Forbidden,
  type MemberId,
  MemberId as MemberIds,
  NotFound,
} from '@homingbird/protocol'
import { type Caller, viewerOf } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { abandonDraft } from './abandoned-drafts.ts'
import { recordAudit } from './audit.ts'
import {
  type ChannelRow,
  channelAgentOf,
  channelOfRoom,
  enter,
  managersOf,
  membersOf,
  startAnswering,
  tellAboutChannel,
} from './channel-rows.ts'
import { lockGroups, lockedChannel } from './group-rows.ts'
import { memberById } from './members.ts'
import type { NoteRow } from './note-rows.ts'
import { syncPrivateQuestionRooms } from './private-questions.ts'
import { announceReview } from './review-events.ts'

/** The channel's agent as its managers see it. Only a manager in the room runs it; an administrator gets no exception. */
export const channelAgentFor = (
  caller: Caller,
  slug: string,
): T.Task<ChannelAgent, AgentFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedChannel(caller, slug)
    return yield* describeAgent(row, yield* existingAgent(row))
  })

/** Makes the channel's one agent: a member of its own kind, put in the room to answer its questions. */
export const createChannelAgent = (
  caller: Caller,
  slug: string,
  name: string,
): T.Task<ChannelAgent, AgentFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const row = yield* managedChannel(caller, slug)
    if ((yield* channelAgentOf(row)) !== null)
      return yield* T.fail(Conflict({ message: 'This channel already has an agent.' }))
    const id = MemberIds.of(env.random.identifier())
    yield* run(
      insertInto('members', {
        id,
        email: `${id}@agents.invalid`,
        subject: `agent:${id}`,
        name: name.trim(),
        profile: '',
        role: 'member',
        status: 'active',
        kind: 'channel_agent',
        event_seq: 0,
        created_at: env.clock.now(),
        last_seen_at: null,
      }),
    )
    yield* enter(row.conversation_id, id)
    yield* startAnswering(row.conversation_id, id)
    yield* syncPrivateQuestionRooms(row)
    yield* tellAboutChannel(row, yield* membersOf(row.conversation_id))
    return yield* describeAgent(row, { id })
  })

export const renameChannelAgent = (
  caller: Caller,
  slug: string,
  name: string,
): T.Task<ChannelAgent, AgentFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedChannel(caller, slug)
    const agent = yield* existingAgent(row)
    yield* run(sql`UPDATE members SET name = ${name.trim()} WHERE id = ${agent.id}`)
    yield* tellAboutChannel(row, yield* membersOf(row.conversation_id))
    return yield* describeAgent(row, agent)
  })

export const retireChannelAgent = (caller: Caller, slug: string): T.Task<void, AgentFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedChannel(caller, slug)
    yield* retireAgent(row, yield* existingAgent(row), null)
    yield* tellAboutChannel(row, yield* membersOf(row.conversation_id))
  })

/**
 * Takes the agent out of its channel for good: deactivated, every credential revoked, out of every room,
 * its waiting drafts discarded. Archiving a channel does this first, so that its agent never moves.
 */
export const retireAgent = (
  row: ChannelRow,
  agent: { readonly id: MemberId },
  archived: string | null,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* run(sql`UPDATE members SET status = 'deactivated' WHERE id = ${agent.id}`)
    yield* run(
      sql`UPDATE credentials SET revoked_at = ${env.clock.now()} WHERE member_id = ${agent.id} AND revoked_at IS NULL`,
    )
    const drafts = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE author_id = ${agent.id} AND status = 'draft' ORDER BY id`,
    )
    for (const draft of drafts) yield* abandonDraft(draft, archived)
    yield* announceReview(yield* managersOf(row), null)
    yield* run(sql`DELETE FROM channel_answerers WHERE member_id = ${agent.id}`)
    yield* run(sql`DELETE FROM participants WHERE member_id = ${agent.id}`)
    yield* syncPrivateQuestionRooms(row)
  })

export const revokeAgentCredential = (
  caller: Caller,
  slug: string,
  id: CredentialId,
): T.Task<ChannelAgent, AgentFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const row = yield* managedChannel(caller, slug)
    const agent = yield* existingAgent(row)
    const credential = yield* first(
      sql`SELECT id FROM credentials WHERE id = ${id} AND member_id = ${agent.id}`,
    )
    if (credential === null) return yield* T.fail(NotFound({ message: 'No such credential.' }))
    yield* run(
      sql`UPDATE credentials SET revoked_at = ${env.clock.now()} WHERE id = ${id} AND revoked_at IS NULL`,
    )
    return yield* describeAgent(row, agent)
  })

/**
 * What changing a channel's managers changes for its agent, in the same locked change: a credential
 * whose issuer is not among the managers is revoked, and its private questions follow the managers.
 */
export const followManagers = (actorId: MemberId, row: ChannelRow): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const agent = yield* channelAgentOf(row)
    if (agent !== null) {
      const managers = yield* managersOf(row)
      const live = yield* all<{ id: CredentialId; issued_by: MemberId | null }>(
        sql`SELECT id, issued_by FROM credentials WHERE member_id = ${agent.id} AND revoked_at IS NULL ORDER BY id`,
      )
      for (const credential of live) {
        if (credential.issued_by !== null && managers.includes(credential.issued_by)) continue
        yield* run(sql`UPDATE credentials SET revoked_at = ${env.clock.now()} WHERE id = ${credential.id}`)
        yield* recordAudit('credential.revoked', {
          actorId,
          targetId: credential.id,
          detail: { because: 'issuer_left' },
        })
      }
    }
    yield* syncPrivateQuestionRooms(row)
  })

/**
 * The agent a manager in the room may issue a credential to; the issuer is recorded, so the credential
 * goes when they stop managing the channel.
 */
export const agentToIssue = (caller: Caller, slug: string): T.Task<MemberId, AgentFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedChannel(caller, slug)
    return (yield* existingAgent(row)).id
  })

/** Whether the issuer still manages the agent's channel, read under the channel group's lock. */
export const mayStillIssue = (agentId: MemberId, issuerId: MemberId): T.Task<boolean, never, RequestEnv> =>
  T.gen(function* () {
    const row = yield* agentsChannel(agentId)
    if (row === null) return false
    yield* lockGroups([row.manager_group_id])
    const current = yield* channelOfRoom(row.conversation_id)
    if (current === null) return false
    return (yield* managersOf(current)).includes(issuerId) && (yield* channelAgentOf(current))?.id === agentId
  })

export type AgentFailure = NotFound | Forbidden | Conflict

const managedChannel = (caller: Caller, slug: string): T.Task<ChannelRow, AgentFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* lockedChannel(viewerOf(caller), slug)
    if (!(yield* managersOf(row)).includes(caller.member.id))
      return yield* T.fail(Forbidden({ message: 'Only a manager of this channel can run its agent.' }))
    return row
  })

const existingAgent = (
  row: ChannelRow,
): T.Task<{ readonly id: MemberId; readonly name: string }, NotFound, RequestEnv> =>
  T.flatMap((agent: { readonly id: MemberId; readonly name: string } | null) =>
    agent === null ? T.fail(NotFound({ message: 'This channel has no agent.' })) : T.succeed(agent),
  )(channelAgentOf(row))

const describeAgent = (
  row: ChannelRow,
  agent: { readonly id: MemberId },
): T.Task<ChannelAgent, never, RequestEnv> =>
  T.gen(function* () {
    const member = yield* T.orDie(memberById(agent.id))
    const credentials = yield* all<CredentialRow>(
      sql`SELECT * FROM credentials WHERE member_id = ${agent.id} ORDER BY created_at DESC, id LIMIT 200`,
    )
    return { agent: member, channel: row.slug, credentials: credentials.map(toAgentCredential) }
  })

const agentsChannel = (agentId: MemberId): T.Task<ChannelRow | null, never, RequestEnv> =>
  first<ChannelRow>(sql`
    SELECT t.* FROM channels t JOIN participants p ON p.conversation_id = t.conversation_id
    WHERE p.member_id = ${agentId} ORDER BY t.slug LIMIT 1`)

interface CredentialRow {
  readonly id: CredentialId
  readonly name: string
  readonly client: string
  readonly created_at: number
  readonly expires_at: number
  readonly last_used_at: number | null
  readonly revoked_at: number | null
  readonly issued_by: MemberId | null
}

const toAgentCredential = (row: CredentialRow): AgentCredential => ({
  id: row.id,
  name: row.name,
  client: row.client,
  createdAt: Number(row.created_at),
  expiresAt: Number(row.expires_at),
  lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
  revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
  issuedBy: row.issued_by,
})

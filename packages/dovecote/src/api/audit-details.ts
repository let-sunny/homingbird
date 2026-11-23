import { Task as T } from '@homingbird/kernel'
import {
  type AuditDetail,
  type AuditEventName,
  type AuditedEventOf,
  type AuditedRoute,
  type Channel,
  type Contract,
  type Group,
  type GroupId,
  type Member,
  type MemberId,
  type RequestOf,
  type ResponseOf,
  type Settings,
  membershipChange,
} from '@homingbird/protocol'
import { type ChannelRow, channelAgentOf, channelRow } from '../domain/channel-rows.ts'
import { teamToCopy } from '../domain/group-membership.ts'
import { lockGroups } from '../domain/group-rows.ts'
import { memberById } from '../domain/members.ts'
import { readSettings } from '../domain/settings.ts'
import { type Caller, viewerOf } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { hashSecret } from '../random.ts'
import { all, first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { deskWakeHostOf } from '../wake/desk-wakes.ts'

/**
 * What each audited route records, from its request and response only: which thing it is about and the
 * catalogue's detail. A route that needs the state before the change reads it first. A route that names
 * an event without an entry here does not type-check.
 */
export const AUDIT_DETAILS: { readonly [N in AuditedRoute]: Describe<N> } = {
  'me.update': (request, caller) =>
    afterwards(() => ({
      targetId: caller.member.id,
      detail: { fields: PROFILE_FIELDS.filter((field) => request.body[field] !== undefined) },
    })),
  'me.character.set': (_, caller) => afterwards(() => ({ targetId: caller.member.id, detail: {} })),
  'me.character.clear': (_, caller) => afterwards(() => ({ targetId: caller.member.id, detail: {} })),
  'me.notifications.set': ({ body }, caller) =>
    afterwards(() => ({ targetId: caller.member.id, detail: { notifications: body.notifications } })),
  'me.deskWake.set': (_, caller) =>
    afterwards((wake) => ({ targetId: caller.member.id, detail: { host: wake.host } })),
  'me.deskWake.remove': (_, caller) =>
    T.map((host: string) => () => ({ targetId: caller.member.id, detail: { host } }))(
      deskWakeHostOf(caller.member.id),
    ),
  'me.slack.link': (_, caller) => afterwards(() => ({ targetId: caller.member.id, detail: {} })),
  'me.slack.unlink': (_, caller) => afterwards(() => ({ targetId: caller.member.id, detail: {} })),
  'me.draftPreviews.set': (_, caller) =>
    afterwards((allowance) => ({
      targetId: caller.member.id,
      detail: { people: allowance.people.length, channels: allowance.channels.length },
    })),
  'channels.slack.link': ({ params, body }) =>
    T.map((code: { slack_channel: string | null } | null) => (): AuditFacts<'slack.channel.linked'> => {
      const channel = JSON.parse(code?.slack_channel ?? '{}') as { id?: string; isPrivate?: boolean }
      return {
        targetId: params.slug,
        detail: { slackChannel: channel.id ?? '', isPrivate: channel.isPrivate === true },
      }
    })(
      first<{ slack_channel: string | null }>(
        sql`SELECT slack_channel FROM slack_codes WHERE code_hash = ${hashSecret(body.code)}`,
      ),
    ),
  'channels.slack.unlink': ({ params }) =>
    T.map(
      (link: { slack_channel_id: string } | null) => (): AuditFacts<'slack.channel.unlinked'> => ({
        targetId: params.slug,
        detail: { slackChannel: link?.slack_channel_id ?? '' },
      }),
    )(
      first<{ slack_channel_id: string }>(sql`SELECT l.slack_channel_id FROM slack_channel_links l
        JOIN channels c ON c.conversation_id = l.conversation_id WHERE c.slug = ${params.slug}`),
    ),
  'conversations.mute': ({ params }) => afterwards(() => ({ targetId: params.id, detail: { muted: true } })),
  'conversations.unmute': ({ params }) =>
    afterwards(() => ({ targetId: params.id, detail: { muted: false } })),
  'conversations.hide': ({ params }) => afterwards(() => ({ targetId: params.id, detail: { hidden: true } })),
  'conversations.unhide': ({ params }) =>
    afterwards(() => ({ targetId: params.id, detail: { hidden: false } })),
  'conversations.leave': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'channels.create': () =>
    afterwards((channel) => ({ targetId: channel.slug, detail: { visibility: channel.visibility } })),
  'channels.join': ({ params }) => afterwards(() => ({ targetId: params.slug, detail: {} })),
  'channels.leave': ({ params }) => afterwards(() => ({ targetId: params.slug, detail: {} })),
  'channels.answering.on': ({ params }) =>
    afterwards(() => ({ targetId: params.slug, detail: { on: true } })),
  'channels.answering.off': ({ params }) =>
    afterwards(() => ({ targetId: params.slug, detail: { on: false } })),
  'channels.members.add': ({ params }) => afterwards(() => onMember(params)),
  'channels.members.remove': ({ params }) => afterwards(() => onMember(params)),
  'channels.managers.addTeam': ({ params, body }, caller) =>
    T.map(
      (copied: { readonly added: MemberId[] } | null) =>
        (channel: Channel): AuditFacts<'group.members_changed'> => ({
          targetId: channel.managedBy,
          detail: { added: copied?.added ?? [], removed: [] },
        }),
    )(T.catchAll(() => T.succeed(null))(teamToCopy(viewerOf(caller), params.slug, body.groupId))),
  'channels.agent.create': () =>
    afterwards((view) => ({ targetId: view.agent.id, detail: { channel: view.channel } })),
  'channels.agent.rename': () =>
    afterwards((view) => ({ targetId: view.agent.id, detail: { channel: view.channel } })),
  'channels.agent.retire': ({ params }) =>
    T.map(
      (agent: { readonly id: MemberId } | null) => (): AuditFacts<'channel.agent_retired'> => ({
        targetId: agent?.id ?? null,
        detail: { channel: params.slug },
      }),
    )(
      T.flatMap((row: ChannelRow | null) => (row === null ? T.succeed(null) : channelAgentOf(row)))(
        channelRow(params.slug),
      ),
    ),
  'channels.agent.credentials.revoke': ({ params }) =>
    afterwards(() => ({ targetId: params.id, detail: {} })),
  'groups.rename': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'groups.members.set': ({ params }) =>
    T.map(
      (before: ReadonlyArray<{ member_id: MemberId }>) =>
        (after: Group): AuditFacts<'group.members_changed'> => ({
          targetId: after.id,
          detail: membershipChange(
            before.map((row) => row.member_id),
            after.memberIds,
          ),
        }),
    )(
      T.flatMap(() =>
        all<{ member_id: MemberId }>(sql`SELECT member_id FROM group_members WHERE group_id = ${params.id}`),
      )(lockGroups([params.id as GroupId])),
    ),
  'contacts.request': ({ body }) => afterwards(() => ({ targetId: body.memberId, detail: {} })),
  'contacts.accept': ({ params }) => afterwards(() => ({ targetId: params.memberId, detail: {} })),
  'contacts.remove': ({ params }) => afterwards(() => ({ targetId: params.memberId, detail: {} })),
  'blocks.add': ({ params }) => afterwards(() => ({ targetId: params.memberId, detail: {} })),
  'blocks.remove': ({ params }) => afterwards(() => ({ targetId: params.memberId, detail: {} })),
  'drafts.send': () =>
    afterwards((note) => ({
      targetId: note.id,
      detail: {
        conversationId: note.conversationId,
        edited: note.origin === 'human_edited',
        ...((note.approvedBy ?? null) !== null && { agentId: note.authorId }),
      },
    })),
  'drafts.discard': () =>
    afterwards((note) => ({ targetId: note.id, detail: { conversationId: note.conversationId } })),
  'channels.agent.teaching.set': ({ params, body }) =>
    T.map(
      (before: TeachingBefore) => (): AuditFacts<'channel.agent_instruction_changed'> => ({
        targetId: before.agentId,
        detail: {
          channel: params.slug,
          fields: [
            ...(before.instruction === body.instruction.trim() ? [] : (['instruction'] as const)),
            ...(JSON.stringify(before.sources) === JSON.stringify(body.sources)
              ? []
              : (['sources'] as const)),
          ],
        },
      }),
    )(teachingBefore(params.slug)),
  'channels.agent.principles.create': ({ params, body }) =>
    afterwards((principle) => ({
      targetId: principle.id,
      detail: {
        channel: params.slug,
        kind: principle.kind,
        ...(body.taughtFrom !== undefined && { taughtFrom: body.taughtFrom }),
      },
    })),
  'channels.agent.principles.update': ({ params, body }) =>
    afterwards(() => ({
      targetId: params.id,
      detail: {
        channel: params.slug,
        fields: CHANNEL_PRINCIPLE_FIELDS.filter((field) => body[field] !== undefined),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      },
    })),
  'channels.agent.principles.reorder': ({ params, body }) =>
    T.map((before: TeachingBefore) => () => ({
      targetId: before.agentId,
      detail: { channel: params.slug, count: body.ids.length },
    }))(teachingBefore(params.slug)),
  'channels.agent.principles.delete': ({ params }) =>
    afterwards(() => ({ targetId: params.id, detail: { channel: params.slug } })),
  'principles.create': () =>
    afterwards((principle) => ({ targetId: principle.id, detail: { kind: principle.kind } })),
  'principles.update': ({ params, body }) =>
    afterwards(() => ({
      targetId: params.id,
      detail: {
        fields: PRINCIPLE_FIELDS.filter((field) => body[field] !== undefined),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      },
    })),
  'principles.autoSend.set': ({ params, body }) =>
    afterwards(() => ({
      targetId: params.id,
      detail: { enabled: body.enabled, places: new Set(body.places).size },
    })),
  'notes.recall': () =>
    afterwards((note) => ({ targetId: note.id, detail: { conversationId: note.conversationId } })),
  'principles.reorder': ({ body }) =>
    afterwards(() => ({ targetId: null, detail: { count: body.ids.length } })),
  'principles.delete': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'teaching.document.set': ({ body }) =>
    afterwards(() => ({ targetId: null, detail: { kept: (body.document ?? '').trim() !== '' } })),
  'principleProposals.create': () =>
    afterwards((proposal) => ({ targetId: proposal.id, detail: { kind: proposal.kind } })),
  'principleProposals.accept': () =>
    afterwards((principle) => ({ targetId: principle.id, detail: { kind: principle.kind } })),
  'principleProposals.acceptAll': ({ body }) =>
    afterwards(() => ({ targetId: null, detail: { count: new Set(body.ids).size } })),
  'principleProposals.discard': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'debates.create': () =>
    afterwards((debate) => ({ targetId: debate.id, detail: { visibility: debate.visibility } })),
  'scheduling.create': () =>
    afterwards((debate) => ({ targetId: debate.id, detail: { visibility: debate.visibility } })),
  'debates.optIn': ({ params, body }) =>
    afterwards(() => ({ targetId: params.id, detail: { credentialId: body.agentId } })),
  'debates.brief.set': ({ params, body }) =>
    afterwards(() => ({ targetId: params.id, detail: { cleared: body.brief.trim() === '' } })),
  'debates.limits.set': ({ params }) =>
    afterwards((debate) => ({ targetId: params.id, detail: { limits: debate.limits } })),
  'debates.result.post': ({ params }) =>
    afterwards((note) => ({ targetId: params.id, detail: { noteId: note.id } })),
  'debates.export': ({ params, body }) =>
    afterwards(() => ({ targetId: params.id, detail: { format: body.format } })),
  'credentials.rename': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'credentials.revoke': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'device.decide': ({ body }) => afterwards(() => ({ targetId: null, detail: { approved: body.approve } })),
  'joinCodes.create': ({ body: { channel } }, caller) =>
    channel === undefined
      ? afterwards(() => ({ targetId: caller.member.id, detail: {} }))
      : T.map(
          (agent: { readonly id: MemberId } | null) => (): AuditFacts<'credential.join_code_created'> => ({
            targetId: agent?.id ?? null,
            detail: { channel },
          }),
        )(
          T.flatMap((row: ChannelRow | null) => (row === null ? T.succeed(null) : channelAgentOf(row)))(
            channelRow(channel),
          ),
        ),
  'invites.create': () =>
    afterwards((link) => ({
      targetId: link.invite.id,
      detail: { boundToEmail: link.invite.email !== null },
    })),
  'invites.revoke': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'consent.decide': ({ params, body }) =>
    afterwards(() => ({ targetId: params.id, detail: { approved: body.approve } })),
  'admin.settings.put': () =>
    T.map(
      (before: Settings) =>
        (after: Settings): AuditFacts<'organization.settings_changed'> => ({
          targetId: null,
          detail: settingsChange(before, after),
        }),
    )(readSettings),
  'admin.slack.credentials.set': () => afterwards(() => ({ targetId: null, detail: {} })),
  'admin.slack.credentials.remove': () => afterwards(() => ({ targetId: null, detail: {} })),
  'admin.members.update': ({ params, body }) =>
    T.map(
      (before: Member | null) =>
        (after: Member): AuditFacts<'member.access_changed'> => ({
          targetId: after.id,
          detail: {
            ...(body.role !== undefined &&
              before !== null && { role: { from: before.role, to: after.role } }),
            ...(body.status !== undefined &&
              before !== null && { status: { from: before.status, to: after.status } }),
          },
        }),
    )(T.catchAll(() => T.succeed(null))(memberById(params.id as MemberId))),
  'admin.members.resetCharacter': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'admin.groups.create': () =>
    afterwards((group) => ({ targetId: group.id, detail: { memberCount: group.memberIds.length } })),
  'admin.groups.delete': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'admin.channels.update': ({ params, body }) =>
    afterwards(() => ({
      targetId: params.slug,
      detail: {
        fields: CHANNEL_FIELDS.filter((field) => body[field] !== undefined),
        ...(body.slug !== undefined && { slug: { from: params.slug, to: body.slug } }),
      },
    })),
  'admin.channels.archive': ({ params, body }) =>
    afterwards(() => ({
      targetId: params.slug,
      detail: body.moveMembersTo === undefined ? {} : { moveMembersTo: body.moveMembersTo },
    })),
}

export interface AuditFacts<E extends AuditEventName> {
  readonly targetId: string | null
  readonly detail: AuditDetail<E>
}

export type Describe<N extends AuditedRoute> = (
  request: RequestOf<Contract[N]>,
  caller: Caller,
) => T.Task<(response: ResponseOf<Contract[N]>) => AuditFacts<AuditedEventOf<N>>, never, RequestEnv>

const PROFILE_FIELDS = ['name', 'profile', 'locale'] as const
const PRINCIPLE_FIELDS = ['kind', 'topic', 'rule', 'source', 'enabled', 'publicText'] as const
const CHANNEL_FIELDS = ['slug', 'description'] as const
const CHANNEL_PRINCIPLE_FIELDS = ['kind', 'topic', 'rule', 'source', 'enabled'] as const

interface TeachingBefore {
  readonly agentId: MemberId | null
  readonly instruction: string
  readonly sources: ReadonlyArray<string>
}

/** The agent and its brief before the change, read so the entry names what changed without its words. */
function teachingBefore(slug: string): T.Task<TeachingBefore, never, RequestEnv> {
  return T.gen(function* () {
    const row = yield* channelRow(slug)
    const agent = row === null ? null : yield* channelAgentOf(row)
    if (agent === null) return { agentId: null, instruction: '', sources: [] }
    const brief = yield* first<{ instruction: string; sources: string }>(
      sql`SELECT instruction, sources FROM channel_agent_teaching WHERE agent_id = ${agent.id}`,
    )
    return {
      agentId: agent.id,
      instruction: brief?.instruction ?? '',
      sources: brief === null ? [] : (JSON.parse(brief.sources) as string[]),
    }
  })
}

function afterwards<R, F>(describe: (response: R) => F): T.Task<(response: R) => F> {
  return T.succeed(describe)
}

function onMember(params: { readonly slug: string; readonly memberId: string }) {
  return { targetId: params.slug, detail: { memberId: params.memberId as MemberId } }
}

function settingsChange(before: Settings, after: Settings): AuditDetail<'organization.settings_changed'> {
  const changed = (
    ['allowedDomains', 'contactMode', 'answeringFlow', 'features', 'whoCanInvite'] as const
  ).filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
  return {
    changed,
    ...(changed.includes('contactMode') && {
      contactMode: { from: before.contactMode, to: after.contactMode },
    }),
    ...(changed.includes('allowedDomains') && {
      allowedDomains: { from: before.allowedDomains, to: after.allowedDomains },
    }),
    ...(changed.includes('features') && {
      features: { from: before.features ?? {}, to: after.features ?? {} },
    }),
    ...(changed.includes('whoCanInvite') && {
      whoCanInvite: { from: before.whoCanInvite ?? 'admins', to: after.whoCanInvite ?? 'admins' },
    }),
  }
}

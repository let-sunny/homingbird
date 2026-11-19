import { Task as T } from '@homingbird/kernel'
import type {
  AuditDetail,
  AuditEventName,
  AuditedEventOf,
  AuditedRoute,
  Contract,
  Member,
  MemberId,
  RequestOf,
  ResponseOf,
  Settings,
} from '@homingbird/protocol'
import { memberById } from '../domain/members.ts'
import { readSettings } from '../domain/settings.ts'
import type { Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'

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
  'channels.create': () =>
    afterwards((channel) => ({ targetId: channel.slug, detail: { visibility: channel.visibility } })),
  'channels.join': ({ params }) => afterwards(() => ({ targetId: params.slug, detail: {} })),
  'channels.leave': ({ params }) => afterwards(() => ({ targetId: params.slug, detail: {} })),
  'channels.answering.on': ({ params }) =>
    afterwards(() => ({ targetId: params.slug, detail: { on: true } })),
  'channels.answering.off': ({ params }) =>
    afterwards(() => ({ targetId: params.slug, detail: { on: false } })),
  'channels.visibility.set': ({ params, body }) =>
    afterwards(() => ({ targetId: params.slug, detail: { visibility: body.visibility } })),
  'channels.members.add': ({ params }) => afterwards(() => onMember(params)),
  'channels.members.remove': ({ params }) => afterwards(() => onMember(params)),
  'channels.managers.add': ({ params }) => afterwards(() => onMember(params)),
  'channels.managers.remove': ({ params }) => afterwards(() => onMember(params)),
  'contacts.request': ({ body }) => afterwards(() => ({ targetId: body.memberId, detail: {} })),
  'contacts.accept': ({ params }) => afterwards(() => ({ targetId: params.memberId, detail: {} })),
  'contacts.remove': ({ params }) => afterwards(() => ({ targetId: params.memberId, detail: {} })),
  'blocks.add': ({ params }) => afterwards(() => ({ targetId: params.memberId, detail: {} })),
  'blocks.remove': ({ params }) => afterwards(() => ({ targetId: params.memberId, detail: {} })),
  'drafts.send': () =>
    afterwards((note) => ({
      targetId: note.id,
      detail: { conversationId: note.conversationId, edited: note.origin === 'human_edited' },
    })),
  'drafts.discard': () =>
    afterwards((note) => ({ targetId: note.id, detail: { conversationId: note.conversationId } })),
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
  'principles.reorder': ({ body }) =>
    afterwards(() => ({ targetId: null, detail: { count: body.ids.length } })),
  'principles.delete': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'debates.create': () =>
    afterwards((debate) => ({ targetId: debate.id, detail: { visibility: debate.visibility } })),
  'debates.optIn': ({ params, body }) =>
    afterwards(() => ({ targetId: params.id, detail: { credentialId: body.agentId } })),
  'debates.limits.set': ({ params, body }) =>
    afterwards(() => ({ targetId: params.id, detail: { limits: body } })),
  'debates.result.post': ({ params }) =>
    afterwards((note) => ({ targetId: params.id, detail: { noteId: note.id } })),
  'debates.export': ({ params, body }) =>
    afterwards(() => ({ targetId: params.id, detail: { format: body.format } })),
  'credentials.rename': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'credentials.revoke': ({ params }) => afterwards(() => ({ targetId: params.id, detail: {} })),
  'device.decide': ({ body }) => afterwards(() => ({ targetId: null, detail: { approved: body.approve } })),
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

function afterwards<R, F>(describe: (response: R) => F): T.Task<(response: R) => F> {
  return T.succeed(describe)
}

function onMember(params: { readonly slug: string; readonly memberId: string }) {
  return { targetId: params.slug, detail: { memberId: params.memberId as MemberId } }
}

function settingsChange(before: Settings, after: Settings): AuditDetail<'organization.settings_changed'> {
  const changed = (['allowedDomains', 'contactMode', 'answeringFlow', 'features'] as const).filter(
    (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
  )
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
  }
}

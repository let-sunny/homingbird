import { Schema as S } from '@homingbird/kernel'
import { AUTO_SEND_PLACES_MAX } from './auto-send.ts'
import { TaughtFrom } from './channel-teaching.ts'
import { CLIENT_KIND } from './client-kinds.ts'
import { DebateExportFormat, DebateLimits, DebateVisibility } from './debates.ts'
import { GROUP_MEMBERS_MAX } from './groups.ts'
import { ConversationId, CredentialId, GroupId, MemberId, NoteId } from './ids.ts'
import {
  ChannelSlug,
  ChannelVisibility,
  ContactMode,
  CredentialKind,
  MemberStatus,
  NOTIFICATION_LEVELS,
  Role,
  WhoCanInvite,
} from './model.ts'
import { PrincipleId, PrincipleKind } from './principles.ts'

/**
 * Every event the audit trail can hold, its tier and what its detail may contain. The detail schema is
 * the allow-list: ids, enums, booleans, numbers and short bounded words, never content and never secrets.
 */
export const AUDIT_EVENTS = {
  'authn.signed_in': event('security', 'member', {}),
  'authn.sign_in_failed': event('security', 'none', { reason: reasonCode() }),
  'authn.signed_out': event('security', 'member', {}),
  'authn.token_refused': event('security', 'credential', {
    count: S.int({ min: 1 }),
    firstAt: S.int({ min: 0 }),
    tokenHash: S.optional(S.string({ pattern: /^[0-9a-f]{16}$/ })),
  }),
  'credential.issued': event('security', 'credential', {
    kind: CredentialKind,
    grant: S.literal('browser', 'device_code', 'authorization_code', 'join_code'),
    clientKind: CLIENT_KIND,
    channelAgent: S.optional(MemberId),
  }),
  'credential.renamed': event('security', 'credential', {}),
  'credential.revoked': event('security', 'credential', {
    because: S.optional(S.literal('issuer_left', 'agent_retired', 'refresh_replayed')),
  }),
  'credential.device_decided': event('security', 'none', { approved: S.boolean }),
  'credential.join_code_created': event('security', 'member', { channel: S.optional(ChannelSlug) }),
  'credential.consent_decided': event('security', 'auth_request', { approved: S.boolean }),
  'oauth.client_registered': event('security', 'oauth_client', { redirectHosts: hostList() }),
  'oauth.client_resolved': event('security', 'oauth_client', { redirectHosts: hostList() }),
  'authz.denied': event('security', 'route', { count: S.int({ min: 1 }), firstAt: S.int({ min: 0 }) }),
  'member.access_changed': event('security', 'member', {
    role: S.optional(change(Role)),
    status: S.optional(change(MemberStatus)),
  }),
  'member.invite_created': event('security', 'auth_request', { boundToEmail: S.boolean }),
  'member.invite_redeemed': event('security', 'auth_request', { memberId: MemberId }),
  'member.invite_revoked': event('security', 'auth_request', {}),
  'organization.settings_changed': event('security', 'organization', {
    changed: S.array(S.literal(...settingKeys()), { maxItems: 10 }),
    contactMode: S.optional(change(ContactMode)),
    allowedDomains: S.optional(change(S.array(S.string({ maxLength: 253 }), { maxItems: 100 }))),
    features: S.optional(change(S.record(S.boolean))),
    whoCanInvite: S.optional(change(WhoCanInvite)),
  }),
  'audit.legacy_purged': event('security', 'none', {
    removed: S.int({ min: 0 }),
    because: S.literal('upgrade', 'command'),
  }),
  'audit.retention_purged': event('security', 'none', {
    removed: S.int({ min: 0 }),
    earlierRemoved: S.int({ min: 0 }),
    lastRemovedHash: S.nullable(S.string({ pattern: /^[0-9a-f]{64}$/ })),
  }),
  'system.started': event('security', 'none', {
    version: S.string({ maxLength: 40 }),
    tier: S.literal('security', 'full'),
    retentionDays: S.union(S.int({ min: 1 }), S.literal('forever')),
  }),
  'system.migrated': event('security', 'none', {
    steps: S.array(S.int({ min: 1 }), { maxItems: 100 }),
  }),
  'group.members_changed': event('security', 'group', {
    added: S.array(MemberId, { maxItems: GROUP_MEMBERS_MAX }),
    removed: S.array(MemberId, { maxItems: GROUP_MEMBERS_MAX }),
    because: S.optional(S.literal('deactivated')),
  }),
  'desk_wake.registered': event('security', 'member', { host: S.string({ maxLength: 253 }) }),
  'desk_wake.removed': event('security', 'member', {
    host: S.string({ maxLength: 253 }),
    because: S.optional(S.literal('deactivated')),
  }),
  'desk_wake.stopped': event('security', 'member', {
    host: S.string({ maxLength: 253 }),
    because: S.literal('refused', 'failures', 'credential_gone', 'unreadable'),
  }),
  'slack.connected': event('security', 'organization', { teamId: S.string({ pattern: /^[A-Z0-9]{1,24}$/ }) }),
  'slack.stopped': event('security', 'organization', {
    because: S.literal('token_refused', 'revoked', 'other_workspace'),
  }),
  'slack.person.linked': event('security', 'member', {}),
  'slack.channel.linked': event('security', 'channel', {
    slackChannel: S.string({ pattern: /^[A-Z0-9]{1,24}$/ }),
    isPrivate: S.boolean,
  }),
  'slack.channel.unlinked': event('security', 'channel', {
    slackChannel: S.string({ pattern: /^[A-Z0-9]{1,24}$/ }),
    because: S.optional(S.literal('channel_archived')),
  }),
  'slack.channel.stopped': event('security', 'channel', {
    slackChannel: S.string({ pattern: /^[A-Z0-9]{1,24}$/ }),
    because: S.literal('app_removed', 'archived', 'deleted', 'pairing', 'failures'),
  }),
  'slack.person.unlinked': event('security', 'member', {
    because: S.optional(S.literal('deactivated', 'slack_deactivated')),
  }),

  'note.approved': event('full', 'note', {
    conversationId: ConversationId,
    edited: S.boolean,
    agentId: S.optional(MemberId),
  }),
  'note.discarded': event('full', 'note', { conversationId: ConversationId }),
  'note.auto_sent': event('full', 'note', { conversationId: ConversationId, principleId: PrincipleId }),
  'note.recalled': event('full', 'note', { conversationId: ConversationId }),
  'draft_preview.allowed_changed': event('full', 'member', {
    people: S.int({ min: 0 }),
    channels: S.int({ min: 0 }),
  }),
  'member.profile_changed': event('full', 'member', {
    fields: S.array(S.literal('name', 'profile', 'locale'), { maxItems: 3 }),
  }),
  'member.notifications_changed': event('full', 'member', {
    notifications: S.literal(...NOTIFICATION_LEVELS),
  }),
  'character.set': event('full', 'member', {}),
  'character.cleared': event('full', 'member', {}),
  'character.reset': event('full', 'member', {}),
  'channel.created': event('full', 'channel', { visibility: ChannelVisibility }),
  /** Recorded by no route: kept so that rows already in the trail still read. */
  'channel.visibility_changed': event('full', 'channel', { visibility: ChannelVisibility }),
  'channel.joined': event('full', 'channel', {}),
  'channel.left': event('full', 'channel', {}),
  'channel.member_added': event('full', 'channel', { memberId: MemberId }),
  'channel.member_removed': event('full', 'channel', { memberId: MemberId }),
  /** Recorded by no route: kept so that rows already in the trail still read. */
  'channel.manager_added': event('full', 'channel', { memberId: MemberId }),
  'channel.manager_removed': event('full', 'channel', { memberId: MemberId }),
  'group.created': event('full', 'group', { memberCount: S.int({ min: 0 }) }),
  'group.renamed': event('full', 'group', {}),
  'group.deleted': event('full', 'group', {}),
  'channel.agent_created': event('security', 'member', { channel: ChannelSlug }),
  'channel.agent_renamed': event('full', 'member', { channel: ChannelSlug }),
  'channel.agent_retired': event('security', 'member', {
    channel: ChannelSlug,
    because: S.optional(S.literal('channel_archived')),
  }),
  'channel.agent_instruction_changed': event('full', 'member', {
    channel: ChannelSlug,
    fields: S.array(S.literal('instruction', 'sources'), { maxItems: 2 }),
  }),
  'channel.agent_principle_created': event('full', 'principle', {
    channel: ChannelSlug,
    kind: PrincipleKind,
    taughtFrom: S.optional(TaughtFrom),
  }),
  'channel.agent_principle_changed': event('full', 'principle', {
    channel: ChannelSlug,
    fields: S.array(S.literal('kind', 'topic', 'rule', 'source', 'enabled'), { maxItems: 5 }),
    enabled: S.optional(S.boolean),
  }),
  'channel.agent_principle_deleted': event('full', 'principle', { channel: ChannelSlug }),
  'channel.agent_principles_reordered': event('full', 'member', {
    channel: ChannelSlug,
    count: S.int({ min: 0 }),
  }),
  'channel.answering_changed': event('full', 'channel', { on: S.boolean }),
  'channel.renamed': event('full', 'channel', {
    fields: S.array(S.literal('slug', 'description'), { maxItems: 2 }),
    slug: S.optional(change(ChannelSlug)),
  }),
  'channel.archived': event('full', 'channel', { moveMembersTo: S.optional(ChannelSlug) }),
  'conversation.mute_changed': event('full', 'conversation', { muted: S.boolean }),
  'contact.requested': event('full', 'member', {}),
  'contact.accepted': event('full', 'member', {}),
  'contact.removed': event('full', 'member', {}),
  'contact.blocked': event('full', 'member', {}),
  'contact.unblocked': event('full', 'member', {}),
  'principle.created': event('full', 'principle', { kind: PrincipleKind }),
  'principle.changed': event('full', 'principle', {
    fields: S.array(S.literal('kind', 'topic', 'rule', 'source', 'enabled', 'publicText'), { maxItems: 6 }),
    enabled: S.optional(S.boolean),
  }),
  'principle.auto_send_changed': event('full', 'principle', {
    enabled: S.boolean,
    places: S.int({ min: 0, max: AUTO_SEND_PLACES_MAX }),
  }),
  'principle.deleted': event('full', 'principle', {}),
  'principle.reordered': event('full', 'none', { count: S.int({ min: 0 }) }),
  'principle.proposed': event('full', 'principle', { kind: PrincipleKind }),
  'principle.proposals_accepted': event('full', 'none', { count: S.int({ min: 0 }) }),
  'principle.proposal_discarded': event('full', 'principle', {}),
  'principle.document_changed': event('full', 'none', { kept: S.boolean }),
  'debate.opened': event('full', 'debate', { visibility: DebateVisibility }),
  'debate.agent_opted_in': event('full', 'debate', { credentialId: CredentialId }),
  'debate.brief_changed': event('full', 'debate', { cleared: S.boolean }),
  'debate.limits_changed': event('full', 'debate', { limits: DebateLimits }),
  'debate.result_posted': event('full', 'debate', { noteId: NoteId }),
  'debate.exported': event('full', 'debate', { format: DebateExportFormat }),
  'debate.concluded': event('full', 'debate', { because: reasonCode() }),
  'debate.ended': event('full', 'debate', { because: reasonCode() }),
  'debate.closed': event('full', 'debate', {
    round: S.int({ min: 0 }),
    draftedBy: MemberId,
    votes: S.nullable(S.int({ min: 0 })),
    drafts: S.int({ min: 0 }),
    droppedOut: S.array(MemberId, { maxItems: 100 }),
  }),
} as const

export type AuditEventName = keyof typeof AUDIT_EVENTS

export type AuditDetail<N extends AuditEventName> = S.Infer<(typeof AUDIT_EVENTS)[N]['detail']>

export type AuditTier = 'security' | 'full'

/**
 * What a contract route keeps: the event it records, with the kind of thing it is about, or why it keeps
 * nothing. `ROUTE_AUDIT` holds one for every route, so a route without a decision does not type-check.
 */
export type AuditDecision =
  | {
      readonly [E in AuditEventName]: {
        readonly event: E
        readonly target: (typeof AUDIT_EVENTS)[E]['target']
      }
    }[AuditEventName]
  | { readonly none: string }

export const AUDIT_TIERS = ['security', 'full'] as const

/** What a row is about. A route-level event names one; `none` means the actor alone says enough. */
export type AuditTargetKind =
  | 'member'
  | 'credential'
  | 'auth_request'
  | 'oauth_client'
  | 'note'
  | 'conversation'
  | 'channel'
  | 'group'
  | 'principle'
  | 'debate'
  | 'organization'
  | 'route'
  | 'none'

export const AuditOutcome = S.literal('success', 'denied', 'failed')
export type AuditOutcome = S.Infer<typeof AuditOutcome>

export const AUDIT_EVENT_NAMES = Object.keys(AUDIT_EVENTS) as AuditEventName[]

export const isAuditEventName = (name: string): name is AuditEventName => Object.hasOwn(AUDIT_EVENTS, name)

/** Whether an event is kept at a tier: `security` keeps only its own events, `full` keeps everything. */
export const isKeptAt = (tier: AuditTier, name: AuditEventName): boolean =>
  tier === 'full' || AUDIT_EVENTS[name].tier === 'security'

/** The longest target id a row keeps: a column holds 400 characters, longer ids are cut. */
export const AUDIT_TARGET_ID_MAX = 400

/** Events that may store the client address and user agent: authentication and credential issuance. */
export const CARRIES_CLIENT_ADDRESS: ReadonlyArray<AuditEventName> = [
  'authn.signed_in',
  'authn.sign_in_failed',
  'authn.signed_out',
  'authn.token_refused',
  'credential.issued',
]

function event<const Tier extends AuditTier, const Target extends AuditTargetKind, const F extends S.Fields>(
  tier: Tier,
  target: Target,
  fields: F,
): { readonly tier: Tier; readonly target: Target; readonly detail: S.StructSchema<F> } {
  return { tier, target, detail: S.struct(fields) }
}

function change<A>(schema: S.Schema<A>) {
  return S.struct({ from: schema, to: schema })
}

function reasonCode() {
  return S.string({ pattern: /^[a-z][a-z_]{0,39}$/ })
}

function hostList() {
  return S.array(S.string({ maxLength: 253, pattern: /^\S+$/ }), { maxItems: 10 })
}

function settingKeys() {
  return ['allowedDomains', 'contactMode', 'answeringFlow', 'features', 'whoCanInvite'] as const
}

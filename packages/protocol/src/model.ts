import { Schema as S } from '@homingbird/kernel'
import { ANSWERING_FLOW_MAX_CHARACTERS } from './answering-flow.ts'
import { CharacterSpec } from './character.ts'
import { UNKNOWN } from './compatibility.ts'
import {
  ConversationId,
  CredentialId,
  DebateId,
  DraftRequestId,
  GroupId,
  MemberId,
  NoteId,
  Timestamp,
} from './ids.ts'

export const NOTE_BODY_MAX = 16_000
export const NoteBody = S.refine<string>(
  'note-body',
  (s) => s.trim().length > 0,
  'expected a non-empty note',
)(S.string({ minLength: 1, maxLength: NOTE_BODY_MAX }))

/** What wrote an agent's note: a label shown to people, never read by a model. */
export const AGENT_LABEL_MAX = 80
export const AgentLabel = S.refine<string>(
  'agent-label',
  (text) => text.trim() !== '' && !/[\p{Cc}\p{Cf}]/u.test(text),
  'expected one line of printable text',
)(S.string({ minLength: 1, maxLength: AGENT_LABEL_MAX }))

/** A label as an integration was handed it, made printable: control and format characters out, at most one line of 80. */
export const agentLabelOf = (text: unknown): string | null => {
  if (typeof text !== 'string') return null
  const label = text
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, AGENT_LABEL_MAX)
    .trim()
  return label === '' ? null : label
}

export const NOTE_BASIS_MAX = 1000
export const NoteBasis = S.string({ maxLength: NOTE_BASIS_MAX })

export const SOURCE_URL_MAX = 2000
export const SourceUrl = S.string({
  minLength: 1,
  maxLength: SOURCE_URL_MAX,
  pattern: /^https?:\/\/[^\s/]+(\/\S*)?$/,
})

export const SOURCE_QUOTE_MAX = 500
export const SourceQuote = S.refine<string>(
  'source-quote',
  (text) => text.trim() !== '',
  'expected the passage the draft used',
)(S.string({ minLength: 1, maxLength: SOURCE_QUOTE_MAX }))

/** A web address or an earlier note a draft rests on, with the passage it used: exactly one of the two. */
export const DraftSource = namingOneTarget(
  S.struct({ url: S.optional(SourceUrl), noteId: S.optional(NoteId), quote: S.optional(SourceQuote) }),
)
export type DraftSource = S.Infer<typeof DraftSource>

export const DRAFT_SOURCES_MAX = 10
export const DraftSources = S.array(DraftSource, { maxItems: DRAFT_SOURCES_MAX })

export const NoteSource = S.struct({
  url: S.optional(S.string({ maxLength: SOURCE_URL_MAX })),
  noteId: S.optional(NoteId),
  conversationId: S.optional(ConversationId),
  quote: S.optional(S.string({ maxLength: SOURCE_QUOTE_MAX })),
})
export type NoteSource = S.Infer<typeof NoteSource>

/** Why a person discarded a channel's agent's answer: kept for its managers, never shown to the asker. */
export const DISCARD_REASON_MAX = 500
export const DiscardReason = S.string({ maxLength: DISCARD_REASON_MAX })

export const PROFILE_MAX = 500

export const Role = S.tolerant(S.literal('member', 'admin'), UNKNOWN)
export type Role = S.Infer<typeof Role>

export const MemberStatus = S.tolerant(S.literal('active', 'deactivated'), UNKNOWN)
export type MemberStatus = S.Infer<typeof MemberStatus>

/** A person, or a channel's agent, which is its own member: unknown reads as not a person. */
export const MemberKind = S.tolerant(S.literal('person', 'channel_agent'), UNKNOWN)
export type MemberKind = S.Infer<typeof MemberKind>

export const LOCALES = ['en', 'ko'] as const
export const Locale = S.tolerant(S.literal(...LOCALES), UNKNOWN)
export type Locale = S.Infer<typeof Locale>
export const DEFAULT_LOCALE: Locale = 'en'

export const Member = S.struct({
  id: MemberId,
  email: S.string({ maxLength: 320 }),
  name: S.string({ maxLength: 200 }),
  profile: S.string({ maxLength: PROFILE_MAX }),
  role: Role,
  status: MemberStatus,
  kind: MemberKind,
  createdAt: Timestamp,
  character: S.nullable(S.tolerant(CharacterSpec, null)),
})
export type Member = S.Infer<typeof Member>

/** The agent credentials a person holds that still work: how many, and when the newest expires. */
export const AgentCredentialsHeld = S.struct({
  memberId: MemberId,
  count: S.int({ min: 1 }),
  newestExpiresAt: Timestamp,
})
export type AgentCredentialsHeld = S.Infer<typeof AgentCredentialsHeld>

/** Only a person signs in, is messaged, joins a group or approves; a kind a client does not know is not one. */
export const isPerson = (member: { readonly kind: string }): boolean => member.kind === 'person'

/** The length lives in `maxLength`, not the pattern, so that a client reads a longer slug a newer server allows. */
export const ChannelSlug = S.string({ pattern: /^[a-z0-9][a-z0-9-]*$/, maxLength: 40 })
export const CHANNEL_DESCRIPTION_MAX = 200

/** Why a running desk's agent cannot answer: out of usage, signed out, or its command keeps failing. */
export const DeskUnavailableKind = S.literal('usage_limit', 'signed_out', 'failed')
export type DeskUnavailableKind = S.Infer<typeof DeskUnavailableKind>

export const Presence = S.struct({
  humanOnline: S.boolean,
  agentOnline: S.boolean,
  /** The desk runs but its agent cannot answer now; absent while it can. */
  agentUnavailable: S.optional(
    /** `kind` is told to the desk's own person only. */
    S.struct({ until: S.nullable(Timestamp), kind: S.optional(S.tolerant(DeskUnavailableKind, UNKNOWN)) }),
  ),
})
export type Presence = S.Infer<typeof Presence>

export const ChannelVisibility = S.tolerant(S.literal('open', 'private'), UNKNOWN)
export type ChannelVisibility = S.Infer<typeof ChannelVisibility>

export const Channel = S.struct({
  slug: ChannelSlug,
  description: S.string({ maxLength: CHANNEL_DESCRIPTION_MAX }),
  conversationId: ConversationId,
  visibility: ChannelVisibility,
  memberCount: S.int({ min: 0 }),
  helperCount: S.int({ min: 0 }),
  joined: S.boolean,
  answering: S.boolean,
  managing: S.boolean,
  managedBy: GroupId,
  /** The channel's own agent, with the `channelAgents` feature on, and whether it is there to answer. */
  agent: S.optional(
    S.nullable(
      S.struct({ id: MemberId, name: S.string({ maxLength: 200 }), presence: S.optional(Presence) }),
    ),
  ),
  /** Whether the viewer manages the channel themself, and so runs its agent and reviews its answers. */
  runsAgent: S.optional(S.boolean),
  createdAt: Timestamp,
})
export type Channel = S.Infer<typeof Channel>

export const ChannelMember = S.struct({ memberId: MemberId, answering: S.boolean, manager: S.boolean })
export type ChannelMember = S.Infer<typeof ChannelMember>

export const Relation = S.tolerant(
  S.literal('self', 'contact', 'request_sent', 'request_received', 'blocked', 'none'),
  UNKNOWN,
)
export type Relation = S.Infer<typeof Relation>

export const PUBLIC_TEXT_MAX = 200

/** A sentence a member wrote for colleagues about one of their agent's principles. */
export const PublicText = S.refine<string>(
  'public-text',
  (text) => text.trim().length > 0 && !text.includes('\n'),
  'expected one line for colleagues',
)(S.string({ minLength: 1, maxLength: PUBLIC_TEXT_MAX }))

export const DirectoryEntry = S.struct({
  member: Member,
  agentIntroduction: S.optional(S.array(PublicText)),
  presence: Presence,
  lastSeenAt: S.nullable(Timestamp),
  relation: Relation,
  canMessage: S.boolean,
  channels: S.array(ChannelSlug),
})
export type DirectoryEntry = S.Infer<typeof DirectoryEntry>

export const ContactMode = S.tolerant(S.literal('open', 'contacts'), UNKNOWN)
export type ContactMode = S.Infer<typeof ContactMode>

export const NoteStatus = S.tolerant(S.literal('draft', 'sent', 'discarded'), UNKNOWN)
export type NoteStatus = S.Infer<typeof NoteStatus>

export const Origin = S.tolerant(S.literal('agent', 'human_edited', 'human'), UNKNOWN)
export type Origin = S.Infer<typeof Origin>

export const ReceiptState = S.tolerant(S.literal('delivered', 'read', 'drafting', 'replied'), UNKNOWN)
export type ReceiptState = S.Infer<typeof ReceiptState>

export const Receipt = S.struct({
  memberId: MemberId,
  state: ReceiptState,
  deliveredAt: Timestamp,
  readAt: S.nullable(Timestamp),
  draftingAt: S.nullable(Timestamp),
  repliedAt: S.nullable(Timestamp),
})
export type Receipt = S.Infer<typeof Receipt>

export const Note = S.struct({
  id: NoteId,
  conversationId: ConversationId,
  authorId: MemberId,
  status: NoteStatus,
  body: S.string({ maxLength: NOTE_BODY_MAX }),
  inReplyTo: S.nullable(NoteId),
  origin: Origin,
  agentName: S.nullable(S.string({ maxLength: 200 })),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  sentAt: S.nullable(Timestamp),
  receipts: S.array(Receipt),
  basis: S.optional(S.nullable(NoteBasis)),
  sources: S.optional(S.array(S.tolerant(NoteSource, null), { maxItems: DRAFT_SOURCES_MAX })),
  agentClient: S.optional(S.nullable(AgentLabel)),
  agentModel: S.optional(S.nullable(AgentLabel)),
  /** The person who approved a channel's agent's note; its author is the agent. */
  approvedBy: S.optional(S.nullable(MemberId)),
  /** A debate room's approved result, posted by a person whose agent took part: which room, which agents. */
  fromDebate: S.optional(
    S.struct({
      debateId: DebateId,
      question: S.string({ maxLength: 500 }),
      agents: S.array(
        S.struct({ agent: S.string({ maxLength: 200 }), person: S.string({ maxLength: 200 }) }),
        { maxItems: 8 },
      ),
    }),
  ),
})
export type Note = S.Infer<typeof Note>

export const DRAFT_INSTRUCTION_MAX = 2000
export const RELEASE_REASON_MAX = 500

export const NoticeKind = S.tolerant(S.literal('released', 'channel_archived'), UNKNOWN)
export type NoticeKind = S.Infer<typeof NoticeKind>

/** Something that happened to one person's note, kept so that it survives a reload; only that person sees it. */
export const Notice = S.struct({
  kind: NoticeKind,
  noteId: NoteId,
  conversationId: ConversationId,
  reason: S.nullable(S.string({ maxLength: RELEASE_REASON_MAX })),
  agentName: S.nullable(S.string({ maxLength: 200 })),
  channel: S.nullable(ChannelSlug),
  at: Timestamp,
})
export type Notice = S.Infer<typeof Notice>

export const DraftRequest = S.struct({
  id: DraftRequestId,
  conversationId: ConversationId,
  inReplyTo: S.nullable(NoteId),
  instruction: S.string({ maxLength: DRAFT_INSTRUCTION_MAX }),
  agentId: S.nullable(CredentialId),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  cancelledAt: S.nullable(Timestamp),
  draftIds: S.array(NoteId),
})
export type DraftRequest = S.Infer<typeof DraftRequest>

export const ConversationKind = S.tolerant(S.literal('direct', 'group', 'channel'), UNKNOWN)
export type ConversationKind = S.Infer<typeof ConversationKind>

export const Conversation = S.struct({
  id: ConversationId,
  kind: ConversationKind,
  title: S.nullable(S.string({ maxLength: 200 })),
  participantIds: S.array(MemberId, { minItems: 1 }),
  createdAt: Timestamp,
  lastActivityAt: Timestamp,
  lastNote: S.nullable(Note),
  unreadCount: S.int({ min: 0 }),
  draftCount: S.int({ min: 0 }),
  archivedAt: S.nullable(Timestamp),
  /** A question asked privately of this channel's agent: its managers, now and later, take part. */
  privateQuestionOf: S.optional(S.nullable(ChannelSlug)),
  /** Who asked a private question: one of its participants. */
  askedBy: S.optional(MemberId),
  /** Which participants of a channel's room or private question manage that channel now. */
  managerIds: S.optional(S.array(MemberId)),
  muted: S.optional(S.boolean),
})
export type Conversation = S.Infer<typeof Conversation>

/** Which conversations may send a person push notifications: every one, those outside channels, or none. */
export const NOTIFICATION_LEVELS = ['all', 'direct', 'none'] as const
export const NotificationLevel = S.tolerant(S.literal(...NOTIFICATION_LEVELS), UNKNOWN)
export type NotificationLevel = S.Infer<typeof NotificationLevel>

export const CredentialKind = S.tolerant(S.literal('human', 'agent'), UNKNOWN)
export type CredentialKind = S.Infer<typeof CredentialKind>

export const Credential = S.struct({
  id: CredentialId,
  kind: CredentialKind,
  name: S.string({ maxLength: 200 }),
  client: S.string({ maxLength: 200 }),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  lastUsedAt: S.nullable(Timestamp),
  revokedAt: S.nullable(Timestamp),
  current: S.boolean,
})
export type Credential = S.Infer<typeof Credential>

export const ContactState = S.tolerant(S.literal('accepted', 'request_sent', 'request_received'), UNKNOWN)
export type ContactState = S.Infer<typeof ContactState>

export const Contact = S.struct({ memberId: MemberId, state: ContactState, since: Timestamp })
export type Contact = S.Infer<typeof Contact>

/** Who may make an invite link: administrators only, or every active member. Unknown reads as admins. */
export const WhoCanInvite = S.tolerant(S.literal('admins', 'members'), UNKNOWN)
export type WhoCanInvite = S.Infer<typeof WhoCanInvite>

export const Settings = S.struct({
  allowedDomains: S.array(S.string({ minLength: 1, maxLength: 253, pattern: /^[a-z0-9.-]+$/ }), {
    maxItems: 100,
  }),
  contactMode: ContactMode,
  auditRetentionDays: S.optional(S.nullable(S.int({ min: 1, max: 36_500 }))),
  answeringFlow: S.optional(S.nullable(S.string({ maxLength: ANSWERING_FLOW_MAX_CHARACTERS }))),
  features: S.optional(S.record(S.boolean)),
  whoCanInvite: S.optional(WhoCanInvite),
})
export type Settings = S.Infer<typeof Settings>

export const AnsweringFlowSetting = S.struct({
  flow: S.nullable(S.string({ maxLength: ANSWERING_FLOW_MAX_CHARACTERS })),
  updatedAt: S.nullable(Timestamp),
})
export type AnsweringFlowSetting = S.Infer<typeof AnsweringFlowSetting>

function namingOneTarget<A extends { readonly url?: string; readonly noteId?: string }>(
  schema: S.Schema<A>,
): S.Schema<A> {
  return S.refine<A>(
    'draft-source',
    (source) => (source.url === undefined) !== (source.noteId === undefined),
    'expected a url or a noteId, not both',
  )(schema)
}

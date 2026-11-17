/**
 * The wire model: what clients and the server exchange. Each schema is the single source for its
 * static type, its validator, and its generated test data.
 */
import { Schema as S } from '@homingbird/kernel'
import { ConversationId, CredentialId, MemberId, NoteId, Timestamp } from './ids.ts'

/** Notes are text and links only. There is no attachment field anywhere in the model. */
export const NOTE_BODY_MAX = 16_000
export const NoteBody = S.refine<string>('note-body', (s) => s.trim().length > 0, 'expected a non-empty note')(
  S.string({ minLength: 1, maxLength: NOTE_BODY_MAX }),
)

export const PROFILE_MAX = 500

export const Role = S.literal('member', 'admin')
export type Role = S.Infer<typeof Role>

export const MemberStatus = S.literal('active', 'deactivated')
export type MemberStatus = S.Infer<typeof MemberStatus>

export const Member = S.struct({
  id: MemberId,
  email: S.string({ maxLength: 320 }),
  name: S.string({ maxLength: 200 }),
  /** A short "what my agent can help with" line shown in the directory. */
  profile: S.string({ maxLength: PROFILE_MAX }),
  role: Role,
  status: MemberStatus,
  createdAt: Timestamp,
})
export type Member = S.Infer<typeof Member>

/** How the viewer relates to a directory entry. Being blocked by someone is never disclosed. */
export const Relation = S.literal('self', 'contact', 'request_sent', 'request_received', 'blocked', 'none')
export type Relation = S.Infer<typeof Relation>

export const Presence = S.struct({ humanOnline: S.boolean, agentOnline: S.boolean })
export type Presence = S.Infer<typeof Presence>

export const DirectoryEntry = S.struct({
  member: Member,
  presence: Presence,
  lastSeenAt: S.nullable(Timestamp),
  relation: Relation,
  canMessage: S.boolean,
})
export type DirectoryEntry = S.Infer<typeof DirectoryEntry>

export const ContactMode = S.literal('open', 'contacts')
export type ContactMode = S.Infer<typeof ContactMode>

// ---------------------------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------------------------

export const NoteStatus = S.literal('draft', 'sent', 'discarded')
export type NoteStatus = S.Infer<typeof NoteStatus>

/** Who wrote the words that were (or will be) sent. */
export const Origin = S.literal('agent', 'human_edited', 'human')
export type Origin = S.Infer<typeof Origin>

export const ReceiptState = S.literal('delivered', 'read', 'drafting', 'replied')
export type ReceiptState = S.Infer<typeof ReceiptState>

export const Receipt = S.struct({
  memberId: MemberId,
  state: ReceiptState,
  deliveredAt: Timestamp,
  /** Set when the recipient's human opened the note. */
  readAt: S.nullable(Timestamp),
  /** Set while one of the recipient's agents holds a reply draft. */
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
  /** Name of the agent credential that drafted the note, when an agent did. */
  agentName: S.nullable(S.string({ maxLength: 200 })),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  sentAt: S.nullable(Timestamp),
  /** One receipt per recipient. Empty until the note is sent. Identical for every participant. */
  receipts: S.array(Receipt),
})
export type Note = S.Infer<typeof Note>

export const ConversationKind = S.literal('dm', 'group')
export type ConversationKind = S.Infer<typeof ConversationKind>

export const Conversation = S.struct({
  id: ConversationId,
  kind: ConversationKind,
  title: S.nullable(S.string({ maxLength: 200 })),
  participantIds: S.array(MemberId, { minItems: 2 }),
  createdAt: Timestamp,
  lastActivityAt: Timestamp,
  lastNote: S.nullable(Note),
  /** Sent notes from others that the viewer's human has not opened. */
  unreadCount: S.int({ min: 0 }),
  /** The viewer's own drafts waiting for approval in this conversation. */
  draftCount: S.int({ min: 0 }),
})
export type Conversation = S.Infer<typeof Conversation>

// ---------------------------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------------------------

/**
 * `human` credentials are held by a person (a browser session, or the approve button of a
 * trusted client). `agent` credentials are handed to a model. Only `human` can approve.
 */
export const CredentialKind = S.literal('human', 'agent')
export type CredentialKind = S.Infer<typeof CredentialKind>

export const Credential = S.struct({
  id: CredentialId,
  kind: CredentialKind,
  name: S.string({ maxLength: 200 }),
  /** The client software, as it identified itself when the credential was issued. */
  client: S.string({ maxLength: 200 }),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  lastUsedAt: S.nullable(Timestamp),
  revokedAt: S.nullable(Timestamp),
  /** True for the credential making the request. */
  current: S.boolean,
})
export type Credential = S.Infer<typeof Credential>

export const ContactState = S.literal('accepted', 'request_sent', 'request_received')
export type ContactState = S.Infer<typeof ContactState>

export const Contact = S.struct({ memberId: MemberId, state: ContactState, since: Timestamp })
export type Contact = S.Infer<typeof Contact>

// ---------------------------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------------------------

export const Settings = S.struct({
  allowedDomains: S.array(S.string({ minLength: 1, maxLength: 253, pattern: /^[a-z0-9.-]+$/ }), { maxItems: 100 }),
  contactMode: ContactMode,
  /** Days to keep audit entries. `null` keeps them forever, which is the default. */
  auditRetentionDays: S.nullable(S.int({ min: 1, max: 36_500 })),
})
export type Settings = S.Infer<typeof Settings>

export const AuditEntry = S.struct({
  id: S.int({ min: 1 }),
  at: Timestamp,
  actorId: S.nullable(MemberId),
  credentialId: S.nullable(CredentialId),
  credentialKind: S.nullable(CredentialKind),
  action: S.string({ maxLength: 100 }),
  /** The id of the thing acted on, when there is one. */
  target: S.nullable(S.string({ maxLength: 200 })),
  /** Action-specific data. For note actions this includes the note content. */
  detail: S.unknown,
})
export type AuditEntry = S.Infer<typeof AuditEntry>

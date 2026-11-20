import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { ConversationId, CredentialId, MemberId } from './ids.ts'
import {
  ContactMode,
  Conversation,
  CredentialKind,
  Locale,
  Member,
  Note,
  NoteBody,
  NotificationLevel,
} from './model.ts'

export const Empty = S.struct({})
export const Digits = S.string({ pattern: /^[0-9]{1,15}$/ })
export const PageLimit = S.string({ pattern: /^[0-9]{1,3}$/ })

/** The most people one note or conversation names besides its author. */
export const RECIPIENTS_MAX = 50

export const Recipients = S.array(MemberId, { minItems: 1, maxItems: RECIPIENTS_MAX })

export const DraftAsShown = S.struct({ body: NoteBody, conversationId: ConversationId })
export type DraftAsShown = S.Infer<typeof DraftAsShown>

export const InboxItem = S.struct({ note: Note, author: Member, conversation: Conversation })
export type InboxItem = S.Infer<typeof InboxItem>

export const DeviceRequest = S.struct({
  userCode: S.string(),
  client: S.string(),
  expiresAt: S.int({ min: 0 }),
})
export type DeviceRequest = S.Infer<typeof DeviceRequest>

/** How long a join code can be redeemed, once, by `homingbird setup` on another computer. */
export const JOIN_CODE_LIFETIME_SECONDS = 600

/** A join code, shown once to the person who created it, and the server address to redeem it at. */
export const JoinCode = S.struct({
  code: S.string(),
  serverUrl: S.string(),
  expiresAt: S.int({ min: 0 }),
})
export type JoinCode = S.Infer<typeof JoinCode>

export const ConsentRequest = S.struct({
  id: S.string(),
  client: S.string(),
  redirectHost: S.string(),
  expiresAt: S.int({ min: 0 }),
})
export type ConsentRequest = S.Infer<typeof ConsentRequest>

export const ServerInfo = S.struct({
  name: S.tolerant(S.literal('dovecote'), UNKNOWN),
  version: S.string(),
  contactMode: ContactMode,
  signInWith: S.string(),
  features: S.optional(S.record(S.boolean)),
  protocolVersion: S.withDefault(S.int({ min: 0 }), 1),
})
export type ServerInfo = S.Infer<typeof ServerInfo>

export const Me = S.struct({
  member: Member,
  credential: S.struct({ id: CredentialId, kind: CredentialKind, name: S.string() }),
  contactMode: ContactMode,
  locale: S.optional(Locale),
  notifications: S.optional(NotificationLevel),
})
export type Me = S.Infer<typeof Me>

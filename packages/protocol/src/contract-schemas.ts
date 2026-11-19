import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { CredentialId, MemberId } from './ids.ts'
import { ContactMode, Conversation, CredentialKind, Locale, Member, Note } from './model.ts'

export const Empty = S.struct({})
export const Digits = S.string({ pattern: /^[0-9]{1,15}$/ })
export const PageLimit = S.string({ pattern: /^[0-9]{1,3}$/ })

export const Recipients = S.array(MemberId, { minItems: 1, maxItems: 50 })

export const InboxItem = S.struct({ note: Note, author: Member, conversation: Conversation })
export type InboxItem = S.Infer<typeof InboxItem>

export const DeviceRequest = S.struct({
  userCode: S.string(),
  client: S.string(),
  expiresAt: S.int({ min: 0 }),
})
export type DeviceRequest = S.Infer<typeof DeviceRequest>

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
})
export type Me = S.Infer<typeof Me>

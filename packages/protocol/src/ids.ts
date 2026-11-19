import { type Brand, Schema as S } from '@homingbird/kernel'

export const MemberId = prefixedId<'MemberId'>('mem')
export type MemberId = S.Infer<typeof MemberId>

export const ConversationId = prefixedId<'ConversationId'>('conv')
export type ConversationId = S.Infer<typeof ConversationId>

export const NoteId = prefixedId<'NoteId'>('note')
export type NoteId = S.Infer<typeof NoteId>

export const CredentialId = prefixedId<'CredentialId'>('cred')
export type CredentialId = S.Infer<typeof CredentialId>

export const DraftRequestId = prefixedId<'DraftRequestId'>('dreq')
export type DraftRequestId = S.Infer<typeof DraftRequestId>

export const DebateId = prefixedId<'DebateId'>('deb')
export type DebateId = S.Infer<typeof DebateId>

export const Timestamp = S.int({ min: 0 })
export type Timestamp = number

function prefixedId<Tag extends string>(prefix: string) {
  const pattern = new RegExp(`^${prefix}_[0-9a-z]{12,40}$`)
  return Object.assign(S.brand<Tag>()(S.string({ pattern, maxLength: 64 })), {
    prefix,
    of: (randomBody: string) => `${prefix}_${randomBody}` as Brand<string, Tag>,
  })
}

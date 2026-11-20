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

export const GroupId = prefixedId<'GroupId'>('grp')
export type GroupId = S.Infer<typeof GroupId>

export const Timestamp = S.int({ min: 0 })
export type Timestamp = number

/** The upper bound is `maxLength`, not the pattern, so that a client reads a longer id a newer server makes. */
function prefixedId<Tag extends string>(prefix: string) {
  const pattern = new RegExp(`^${prefix}_[0-9a-z]{12,}$`)
  const bodyMax = 40
  return Object.assign(S.brand<Tag>()(S.string({ pattern, maxLength: `${prefix}_`.length + bodyMax })), {
    prefix,
    of: (randomBody: string) => `${prefix}_${randomBody}` as Brand<string, Tag>,
  })
}

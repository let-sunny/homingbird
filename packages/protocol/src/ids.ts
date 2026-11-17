/**
 * Identifiers. Every id is an opaque string with a type prefix; the brand keeps a NoteId from
 * being passed where a MemberId is expected.
 */
import { type Brand, Schema as S } from '@homingbird/kernel'

const ID_BODY = '[0-9a-z]{12,40}'

const id = <Tag extends string>(prefix: string) => {
  const pattern = new RegExp(`^${prefix}_${ID_BODY}$`)
  const schema = S.brand<Tag>()(S.string({ pattern, maxLength: 64 }))
  return Object.assign(schema, {
    prefix,
    /** Builds an id from an already-random body. */
    of: (body: string) => `${prefix}_${body}` as Brand<string, Tag>,
  })
}

export const MemberId = id<'MemberId'>('mem')
export type MemberId = S.Infer<typeof MemberId>

export const ConversationId = id<'ConversationId'>('conv')
export type ConversationId = S.Infer<typeof ConversationId>

export const NoteId = id<'NoteId'>('note')
export type NoteId = S.Infer<typeof NoteId>

export const CredentialId = id<'CredentialId'>('cred')
export type CredentialId = S.Infer<typeof CredentialId>

/** Timestamps travel as integer milliseconds since the Unix epoch. */
export const Timestamp = S.int({ min: 0 })
export type Timestamp = number

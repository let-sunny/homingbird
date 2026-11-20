import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { GroupId, MemberId, Timestamp } from './ids.ts'
import { ChannelSlug } from './model.ts'

export const GROUP_NAME_MAX = 80
export const GROUP_MEMBERS_MAX = 500

/** Unique ignoring case, which the server checks. */
export const GroupName = S.refine<string>(
  'group-name',
  (text) => text.trim() !== '' && !/[\p{Cc}\p{Cf}]/u.test(text),
  'expected one line of printable text',
)(S.string({ minLength: 1, maxLength: GROUP_NAME_MAX }))
export type GroupName = S.Infer<typeof GroupName>

/** A `team` is named by an administrator; a `channel` group, unnamed, holds one channel's managers. */
export const GroupKind = S.tolerant(S.literal('team', 'channel'), UNKNOWN)
export type GroupKind = S.Infer<typeof GroupKind>

/** `channels` names a `channel` group's channel; `mayAdd` and `mayRemove` are the viewer's. */
export const Group = S.struct({
  id: GroupId,
  kind: GroupKind,
  name: S.nullable(GroupName),
  memberIds: S.array(MemberId, { maxItems: GROUP_MEMBERS_MAX }),
  channels: S.array(ChannelSlug),
  mayAdd: S.boolean,
  mayRemove: S.boolean,
  createdAt: Timestamp,
})
export type Group = S.Infer<typeof Group>

/** Whom a new list of members adds and removes, each once, in the order of the list that names them. */
export const membershipChange = <A>(
  before: ReadonlyArray<A>,
  after: ReadonlyArray<A>,
): { readonly added: A[]; readonly removed: A[] } => {
  const kept = new Set(before)
  const wanted = new Set(after)
  return {
    added: [...wanted].filter((each) => !kept.has(each)),
    removed: [...kept].filter((each) => !wanted.has(each)),
  }
}

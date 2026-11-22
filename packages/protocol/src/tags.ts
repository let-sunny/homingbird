import { Schema as S } from '@homingbird/kernel'
import { MemberId } from './ids.ts'

/**
 * Whom a group note asks: the people it tags; a reply that tags nobody, the author it answers; a new
 * note that tags nobody, everyone, which is the empty list.
 */
export const tagsAsked = (note: {
  readonly authorId: MemberId
  readonly tags: ReadonlyArray<MemberId>
  readonly answeredAuthorId: MemberId | null
}): MemberId[] => {
  const tagged = [...new Set(note.tags)].filter((id) => id !== note.authorId).sort()
  if (tagged.length > 0) return tagged
  return note.answeredAuthorId === null || note.answeredAuthorId === note.authorId
    ? []
    : [note.answeredAuthorId]
}

export const isAsked = (tags: ReadonlyArray<MemberId> | undefined, memberId: MemberId): boolean =>
  tags === undefined || tags.length === 0 || tags.includes(memberId)

export const isSameTags = (
  left: ReadonlyArray<MemberId> | undefined,
  right: ReadonlyArray<MemberId> | undefined,
): boolean => {
  const one = new Set(left ?? [])
  const other = new Set(right ?? [])
  return one.size === other.size && [...one].every((id) => other.has(id))
}

export const TAGS_MAX = 50

export const NoteTags = S.array(MemberId, { maxItems: TAGS_MAX })
export type NoteTags = S.Infer<typeof NoteTags>

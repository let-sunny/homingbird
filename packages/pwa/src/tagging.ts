import { type AsRead, type MemberId, tagsAsked } from '@homingbird/protocol'

/**
 * The tags a note written in a room is drafted with, and the tags the server stores for it, which the
 * send names as shown; null where nobody can be tagged: a direct message, a channel, a private
 * question, or while tagging is off.
 */
export const tagsToSend = (input: {
  readonly room: AsRead.Conversation | undefined
  readonly authorId: MemberId
  readonly chosen: ReadonlyArray<MemberId>
  readonly answered: Pick<AsRead.Note, 'authorId'> | null
  readonly taggingOn: boolean
}): TagsToSend | null => {
  const { room, authorId, answered } = input
  if (room === undefined || !isTaggable(room) || !input.taggingOn) return null
  const others = new Set(room.participantIds.filter((id) => id !== authorId))
  const tags = [...new Set(input.chosen)].filter((id) => others.has(id))
  const answeredAuthorId =
    answered !== null && room.participantIds.includes(answered.authorId) ? answered.authorId : null
  return { tags, asked: tagsAsked({ authorId, tags, answeredAuthorId }) }
}

export interface TagsToSend {
  /** The people the person tagged who are in the room. */
  readonly tags: ReadonlyArray<MemberId>
  /** Whom the note asks once sent, as the server stores it; none means everyone. */
  readonly asked: ReadonlyArray<MemberId>
}

const isTaggable = (room: AsRead.Conversation): boolean =>
  room.kind === 'group' && (room.privateQuestionOf ?? null) === null

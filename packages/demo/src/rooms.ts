import { Task as T } from '@homingbird/kernel'
import { type ApiError, type ConversationId, Invalid, type MemberId, NotFound } from '@homingbird/protocol'
import { found } from './handlers.ts'
import type { ConversationRecord, Records, World } from './world.ts'

/** Where a new draft goes: a conversation the viewer takes part in, a channel's room, or the one with these people. */
export const destinationOf = (
  world: World,
  viewerId: MemberId,
  body: {
    readonly conversationId?: ConversationId
    readonly to?: ReadonlyArray<MemberId>
    readonly channel?: string
  },
): T.Task<ConversationRecord, ApiError> => {
  const records = world.records()
  if (body.conversationId !== undefined) return roomOf(records, viewerId, body.conversationId)
  if (body.channel !== undefined) {
    const channel = records.channels.find((each) => each.slug === body.channel)
    return channel === undefined
      ? T.fail(Invalid({ message: 'No such channel.' }))
      : roomOf(records, viewerId, channel.conversationId)
  }
  if (body.to !== undefined && body.to.length > 0) {
    const unknown = body.to.find((id) => !records.members.some(({ member }) => member.id === id))
    return unknown === undefined
      ? T.succeed(roomWith(world, viewerId, body.to, null))
      : T.fail(NotFound({ message: 'No such member.' }))
  }
  return T.fail(Invalid({ message: 'Say which conversation the draft is for.' }))
}

/** A conversation the viewer takes part in. */
export const roomOf = (
  records: Records,
  viewerId: MemberId,
  id: string,
): T.Task<ConversationRecord, ApiError> =>
  found(
    records.conversations.find((room) => room.id === id && room.participantIds.includes(viewerId)),
    'No such conversation.',
  )

/** The viewer's direct or group conversation with exactly these people, started when there is none. */
export const roomWith = (
  world: World,
  viewerId: MemberId,
  others: ReadonlyArray<MemberId>,
  title: string | null,
): ConversationRecord => {
  const participantIds = [viewerId, ...others.filter((id) => id !== viewerId)]
  const existing = world
    .records()
    .conversations.find(
      (room) =>
        room.kind !== 'channel' &&
        room.privateQuestionOf === undefined &&
        room.participantIds.length === participantIds.length &&
        participantIds.every((id) => room.participantIds.includes(id)),
    )
  if (existing !== undefined) return existing
  const room = newRoom(world, participantIds, title)
  world.update((records) => ({ ...records, conversations: [...records.conversations, room] }))
  return room
}

const newRoom = (
  world: World,
  participantIds: ReadonlyArray<MemberId>,
  title: string | null,
): ConversationRecord => {
  const now = world.clock.now()
  return {
    id: world.nextId('conv') as ConversationId,
    kind: participantIds.length === 2 ? 'direct' : 'group',
    title,
    participantIds,
    createdAt: now,
    lastActivityAt: now,
    mutedBy: [],
    ...(participantIds.length > 2 && { startedBy: participantIds[0]! }),
  }
}

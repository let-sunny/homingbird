import {
  type Channel,
  type Conversation,
  type DirectoryEntry,
  type Group,
  type Member,
  type MemberId,
  type Note,
  type Review,
  canMessage,
  relation,
  reviewerStanding,
} from '@homingbird/protocol'
import { VISITOR_ID } from './team.ts'
import type { ChannelRecord, ConversationRecord, Records } from './world.ts'

/**
 * Whether a viewer may read a note: a sent one in a conversation they take part in, their own draft,
 * or a channel's agent's draft they review. A draft is never shown to the person it answers (rule 2).
 */
export const mayRead = (records: Records, viewerId: MemberId, note: Note): boolean => {
  if (note.authorId === viewerId) return true
  if (note.status === 'draft') return reviewOf(records, viewerId, note) !== null
  return note.status === 'sent' && isParticipant(records, viewerId, note.conversationId)
}

/** The conversations a viewer sees: rooms of channels they joined, and those with a note they may read. */
export const conversationsOf = (records: Records, viewerId: MemberId): Conversation[] =>
  records.conversations
    .filter(
      (room) =>
        room.participantIds.includes(viewerId) &&
        (room.kind === 'channel' ||
          room.startedBy === viewerId ||
          room.privateQuestionOf?.askedBy === viewerId ||
          records.notes.some(
            (note) =>
              note.conversationId === room.id &&
              (note.status === 'sent' || (note.status === 'draft' && note.authorId === viewerId)),
          )),
    )
    .map((room) => conversationAsSeen(records, viewerId, room))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)

export const conversationAsSeen = (
  records: Records,
  viewerId: MemberId,
  room: ConversationRecord,
): Conversation => {
  const inRoom = records.notes.filter((note) => note.conversationId === room.id)
  const sent = inRoom.filter((note) => note.status === 'sent')
  return {
    id: room.id,
    kind: room.kind,
    title: room.title,
    participantIds: [...room.participantIds],
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt,
    lastNote: sent.reduce<Note | null>(
      (latest, note) => (latest === null || (note.sentAt ?? 0) >= (latest.sentAt ?? 0) ? note : latest),
      null,
    ),
    unreadCount: sent.filter((note) =>
      note.receipts.some(
        (receipt) => receipt.memberId === viewerId && receipt.readAt === null && receipt.repliedAt === null,
      ),
    ).length,
    draftCount: inRoom.filter((note) => note.status === 'draft' && note.authorId === viewerId).length,
    archivedAt: null,
    privateQuestionOf: room.privateQuestionOf?.slug ?? null,
    muted: room.mutedBy.includes(viewerId),
  }
}

/** A conversation's notes as the viewer reads them: the sent ones oldest first, then their own drafts. */
export const notesSeenIn = (records: Records, viewerId: MemberId, conversationId: string): Note[] => {
  const inRoom = records.notes.filter((note) => note.conversationId === conversationId)
  return [
    ...inRoom.filter((note) => note.status === 'sent').sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0)),
    ...inRoom
      .filter((note) => note.status === 'draft' && note.authorId === viewerId)
      .sort((a, b) => a.createdAt - b.createdAt),
  ]
}

export const channelAsSeen = (records: Records, viewerId: MemberId, channel: ChannelRecord): Channel => {
  const room = records.conversations.find((each) => each.id === channel.conversationId)
  const participants = room?.participantIds ?? []
  const managing = managersOf(records, channel).includes(viewerId)
  const agent = channel.agentId === null ? null : memberById(records, channel.agentId)
  return {
    slug: channel.slug,
    description: channel.description,
    conversationId: channel.conversationId,
    visibility: channel.visibility,
    memberCount: participants.filter((id) => memberById(records, id)?.kind === 'person').length,
    helperCount: channel.answering.length,
    joined: participants.includes(viewerId),
    answering: channel.answering.includes(viewerId),
    managing,
    managedBy: channel.managedBy,
    agent: agent === null ? null : { id: agent.id, name: agent.name },
    runsAgent: managing,
    createdAt: channel.createdAt,
  }
}

/** The people of the organization, as the directory lists them to the viewer. */
export const directoryOf = (
  records: Records,
  viewerId: MemberId,
  among: { readonly q?: string | undefined; readonly channel?: string; readonly group?: string },
): DirectoryEntry[] => {
  const needle = among.q?.trim().toLowerCase() ?? ''
  const helpers = records.channels.find((channel) => channel.slug === among.channel)?.answering
  const team = records.groups.find((group) => group.id === among.group && group.kind === 'team')
  return records.members
    .filter(({ member }) => member.kind === 'person' && member.status === 'active')
    .filter(({ member }) =>
      [member.name, member.email, member.profile].some((text) => text.toLowerCase().includes(needle)),
    )
    .filter(({ member }) => among.channel === undefined || (helpers ?? []).includes(member.id))
    .filter(({ member }) => among.group === undefined || (team?.memberIds ?? []).includes(member.id))
    .sort((a, b) => a.member.name.localeCompare(b.member.name))
    .map(({ member, presence, lastSeenAt }) => {
      const isSelf = member.id === viewerId
      return {
        member,
        presence,
        lastSeenAt,
        relation: relation({ isSelf, blockedByViewer: false, contact: null }),
        canMessage: canMessage({
          mode: 'open',
          isSelf,
          recipientStatus: member.status,
          recipientIsPerson: true,
          blocked: false,
          contact: false,
        }),
        channels: records.channels
          .filter((channel) => channel.answering.includes(member.id))
          .map((channel) => channel.slug),
        agentIntroduction: records.principles.flatMap((principle) =>
          member.id === VISITOR_ID && principle.enabled && principle.publicText !== null
            ? [principle.publicText]
            : [],
        ),
      }
    })
}

/**
 * The groups the viewer may see: every team, which an administrator changes, and the managing group of
 * each channel they can see, which its own members change.
 */
export const groupsOf = (records: Records, viewerId: MemberId): Group[] =>
  records.groups.map((group) => {
    const channels = records.channels.filter((channel) => channel.managedBy === group.id)
    const mayChange =
      group.kind === 'team'
        ? memberById(records, viewerId)?.role === 'admin'
        : group.memberIds.includes(viewerId)
    return {
      id: group.id,
      kind: group.kind,
      name: group.name,
      memberIds: [...group.memberIds],
      channels: channels.map((channel) => channel.slug),
      mayAdd: mayChange,
      mayRemove: mayChange,
      createdAt: group.createdAt,
    }
  })

/** The answers of channels' agents waiting for this viewer as one of the managers who may send them. */
export const reviewsOf = (records: Records, viewerId: MemberId): Review[] =>
  records.notes
    .filter((note) => note.status === 'draft')
    .flatMap((note) => {
      const review = reviewOf(records, viewerId, note)
      return review === null ? [] : [review]
    })

export const reviewOf = (records: Records, viewerId: MemberId, note: Note): Review | null => {
  const channel = records.channels.find((each) => each.agentId === note.authorId)
  const agent = memberById(records, note.authorId)
  const viewer = memberById(records, viewerId)
  if (note.status !== 'draft' || channel === undefined || agent === null || viewer === null) return null
  const question =
    note.inReplyTo === null ? null : (records.notes.find((each) => each.id === note.inReplyTo) ?? null)
  const standing = reviewerStanding({
    reviewerId: viewerId,
    isPerson: viewer.kind === 'person',
    managers: managersOf(records, channel),
    askers: question === null ? [] : [question.authorId],
  })
  const privately = records.conversations.some(
    (room) => room.id === note.conversationId && room.privateQuestionOf !== undefined,
  )
  return standing === 'reviewer' ? { note, question, channel: channel.slug, agent, privately } : null
}

export const memberById = (records: Records, id: MemberId): Member | null =>
  records.members.find((each) => each.member.id === id)?.member ?? null

export const managersOf = (records: Records, channel: ChannelRecord): ReadonlyArray<MemberId> =>
  records.groups.find((group) => group.id === channel.managedBy)?.memberIds ?? []

export const isParticipant = (records: Records, viewerId: MemberId, conversationId: string): boolean =>
  records.conversations.some((room) => room.id === conversationId && room.participantIds.includes(viewerId))

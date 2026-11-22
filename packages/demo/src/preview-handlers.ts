import { Task as T } from '@homingbird/kernel'
import {
  type DraftPreview,
  type DraftPreviewAllowance,
  type MemberId,
  NO_DRAFT_PREVIEWS,
  NotFound,
  isPreviewableDraft,
  previewViewers,
} from '@homingbird/protocol'
import type { Handlers } from './handlers.ts'
import { isParticipant } from './reads.ts'
import type { Records, World } from './world.ts'

/** Whom the visitor lets see their agent's drafts early, and the colleagues' drafts they may see. */
export const previewHandlers = (world: World): Handlers => ({
  'me.draftPreviews.get': (_, viewerId) => T.sync(() => allowanceOf(world.records(), viewerId)),
  'me.draftPreviews.set': ({ body }, viewerId) =>
    T.sync(() => {
      const allowance = { people: [...new Set(body.people)], channels: [...new Set(body.channels)] }
      world.update((records) => ({
        ...records,
        previewAllowances: [
          ...records.previewAllowances.filter((kept) => kept.memberId !== viewerId),
          { memberId: viewerId, allowance },
        ],
      }))
      return allowance
    }),
  'previews.list': ({ params }, viewerId) =>
    isParticipant(world.records(), viewerId, params.id)
      ? T.sync(() => ({ previews: previewsSeenIn(world.records(), viewerId, params.id) }))
      : T.fail(NotFound({ message: 'No such conversation.' })),
})

const allowanceOf = (records: Records, memberId: MemberId): DraftPreviewAllowance =>
  records.previewAllowances.find((kept) => kept.memberId === memberId)?.allowance ?? NO_DRAFT_PREVIEWS

const previewsSeenIn = (records: Records, viewerId: MemberId, conversationId: string): DraftPreview[] => {
  const room = records.conversations.find((each) => each.id === conversationId)
  if (room === undefined) return []
  const place = {
    kind: room.kind,
    participantIds: room.participantIds,
    channel: records.channels.find((channel) => channel.conversationId === room.id)?.slug ?? null,
    isPrivateQuestion: false,
  }
  return records.notes
    .filter(
      (note) =>
        note.conversationId === conversationId &&
        note.authorId !== viewerId &&
        isPreviewableDraft(note) &&
        previewViewers(allowanceOf(records, note.authorId), note.authorId, place).includes(viewerId),
    )
    .map((note) => ({
      noteId: note.id,
      conversationId: note.conversationId,
      authorId: note.authorId,
      agentName: note.agentName,
      inReplyTo: note.inReplyTo,
      state: 'unconfirmed' as const,
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }))
}

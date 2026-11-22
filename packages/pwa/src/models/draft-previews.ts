import {
  type AsRead,
  type MemberId,
  type NoteId,
  isPreviewableDraft,
  previewViewers,
} from '@homingbird/protocol'
import { channelOfRoom } from '../channels.ts'
import { listOf, strings } from '../strings.ts'
import { type ThreadInput, isOn, nameIn, notesOf, roomOf } from './thread-room.ts'

/**
 * Below a conversation's notes: other people's agents' drafts this person may see early, each marked as
 * unconfirmed or withdrawn, and, on the author's side, who can see their own agent's draft here.
 */
export const draftPreviewsModel = (input: PreviewInput): DraftPreviewsModel => {
  if (!isOn(input, 'draftPreviews')) return { cards: [], ownNotice: null }
  return {
    cards: input.previews.map((preview) => previewCard(input, preview)),
    ownNotice: ownNoticeOf(input),
  }
}

/** What a sent note says to someone who saw it early: that its author checked it, and whether they changed it. */
export const confirmedPreviewLine = (
  input: Pick<ThreadInput, 'members' | 'previewedBodies' | 'me'>,
  note: AsRead.Note,
): string | null => {
  const seen = input.previewedBodies.get(note.id)
  if (seen === undefined || note.status !== 'sent' || note.authorId === input.me.member.id) return null
  const name = nameIn(input, note.authorId)
  return seen === note.body
    ? strings.draftPreviews.confirmed({ name })
    : strings.draftPreviews.confirmedEdited({ name })
}

export interface PreviewInput extends ThreadInput {
  readonly previews: ReadonlyArray<AsRead.DraftPreview>
  readonly allowance: AsRead.DraftPreviewAllowance | null
}

export interface DraftPreviewsModel {
  readonly cards: ReadonlyArray<PreviewCard>
  readonly ownNotice: string | null
}

export interface PreviewCard {
  readonly noteId: NoteId
  readonly withdrawn: boolean
  readonly title: string
  readonly note: string
  readonly body: string | null
}

const previewCard = (input: PreviewInput, preview: AsRead.DraftPreview): PreviewCard => {
  const name = nameIn(input, preview.authorId)
  if (preview.state !== 'unconfirmed' || preview.body === null)
    return {
      noteId: preview.noteId,
      withdrawn: true,
      title: strings.draftPreviews.withdrawn({ name }),
      note: strings.draftPreviews.withdrawnNote,
      body: null,
    }
  return {
    noteId: preview.noteId,
    withdrawn: false,
    title: strings.draftPreviews.cardTitle({ name }),
    note: strings.draftPreviews.cardNote({ name }),
    body: preview.body,
  }
}

const ownNoticeOf = (input: PreviewInput): string | null => {
  const allowance = input.allowance
  const room = roomOf(input)
  if (allowance === null || room === undefined) return null
  const me = input.me.member.id
  const waiting = notesOf(input).some(
    (note) =>
      note.authorId === me && isPreviewableDraft(note) && note.conversationId === input.conversationId,
  )
  if (!waiting) return null
  const viewers = previewViewers(allowance, me, placeOf(input, room))
  if (viewers.length === 0) return null
  return room.kind === 'channel'
    ? strings.draftPreviews.ownNoticeRoom
    : strings.draftPreviews.ownNotice({ names: listOf(viewers.map((id: MemberId) => nameIn(input, id))) })
}

const placeOf = (input: PreviewInput, room: AsRead.Conversation) => ({
  kind: room.kind,
  participantIds: room.participantIds,
  channel: channelOfRoom(input.channels, input.conversationId)?.slug ?? null,
  isPrivateQuestion: room.privateQuestionOf !== undefined,
})

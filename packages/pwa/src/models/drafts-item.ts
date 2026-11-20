import type { AsRead, ConversationId, MemberId } from '@homingbird/protocol'
import { agentNameOf } from '../agent-names.ts'
import { approvesQuicklyOften, carefulReadingFor } from '../careful-reading.ts'
import { channelLabel, channelOfRoom } from '../channels.ts'
import { type DraftBasis, draftBasisOf } from '../draft-basis.ts'
import { isChangedSinceRead } from '../drafts-read.ts'
import type { Thread } from '../state.ts'
import { listOf, strings } from '../strings.ts'
import {
  type ThreadItem,
  alternativesLeftAfterSending,
  conversationTitle,
  draftDestination,
  excerpt,
  isArchived,
} from '../thread.ts'
import { type AvatarModel, memberAvatarOf } from './avatar.ts'
import { type AppliedMarker, appliedModel, showsAppliedMarkers } from './teaching.ts'
import { type ThreadInput, isOn, nameIn, noteIn, notesOf, roomOf } from './thread-room.ts'

/**
 * The drafts waiting for the person's approval in one place of the conversation, each as a card; the
 * one a link opened the conversation at is the focused card.
 */
export const draftsItemModel = (
  input: ThreadInput,
  item: Extract<ThreadItem, { type: 'drafts' }>,
): DraftsItemModel => {
  const target = noteIn(input, item.inReplyTo)
  const room = roomOf(input)
  const archived = isArchived(room)
  const channel = room?.kind === 'channel' ? channelOfRoom(input.channels, input.conversationId) : null
  const question = channel !== null && item.inReplyTo === null
  return {
    avatar: memberAvatarOf(input.members.get(input.me.member.id), isOn(input, 'characters'), {
      state: 'awaiting-approval',
      labelled: false,
    }),
    heading: strings.waitingForApproval,
    replyTo:
      target === null ? strings.newNoteDraft : strings.draftReplyTo({ excerpt: excerpt(target.body, 60) }),
    choose: item.drafts.length > 1 ? strings.chooseOne({ count: item.drafts.length }) : null,
    archived: archived ? strings.archivedRoomNotice : null,
    cards: item.drafts.map((draft) =>
      draftCard(input, item, draft, room, archived, question ? channel : null),
    ),
  }
}

/**
 * After a send from the editor was refused, the draft as it stands now, for the editor to show beside
 * the person's edit; null once it was sent or discarded, and the editor has nothing left to send. When
 * the draft moved to another room, `moved` says where it goes now, and the editor sends nothing until
 * the person confirms it.
 */
export const draftChangedWhileEditing = (input: EditorInput, read: AsRead.Note): EditorChange | null => {
  const now = [...input.threads.values()]
    .flatMap((thread) => thread.notes)
    .find((note) => note.id === read.id && note.status === 'draft')
  if (now === undefined) return null
  if (now.conversationId === read.conversationId)
    return { notice: strings.draftChangedWhileEditing, body: now.body, draft: now, moved: null }
  const room = input.conversations.find((candidate) => candidate.id === now.conversationId)
  const channel =
    room?.kind === 'channel' && now.inReplyTo === null ? channelOfRoom(input.channels, room.id) : null
  const destination =
    room === undefined
      ? null
      : destinationOf({ ...input, thread: input.threads.get(room.id) }, now.authorId, now, room, channel)
  return {
    notice: strings.draftMovedWhileEditing,
    body: now.body,
    draft: now,
    moved: { destination: destination?.text ?? null, confirm: strings.draftConfirmRoom },
  }
}

export interface EditorInput extends Pick<ThreadInput, 'conversations' | 'channels' | 'members'> {
  readonly threads: ReadonlyMap<ConversationId, Thread>
}

export interface EditorChange {
  readonly notice: string
  readonly body: string
  readonly draft: AsRead.Note
  readonly moved: { readonly destination: string | null; readonly confirm: string } | null
}

export interface DraftsItemModel {
  readonly avatar: AvatarModel
  readonly heading: string
  readonly replyTo: string
  readonly choose: string | null
  readonly archived: string | null
  readonly cards: ReadonlyArray<DraftCard>
}

export interface DraftCard {
  readonly draft: AsRead.Note
  readonly focused: boolean
  readonly origin: { readonly className: string; readonly text: string }
  readonly body: string
  readonly basis: DraftBasis | null
  readonly applied: ReadonlyArray<AppliedMarker>
  readonly destination:
    | { readonly kind: 'channel'; readonly text: string; readonly channel: AsRead.Channel }
    | { readonly kind: 'people'; readonly text: string }
    | null
  readonly careful: string | null
  /**
   * Set when an agent changed the text or the room after the person read the draft: the card says so
   * and offers no way to send until the person has read it again.
   */
  readonly readAgain: { readonly notice: string; readonly confirm: string } | null
  /** Null in an archived room, where nothing is sent. */
  readonly actions: {
    readonly alternatives: ReadonlyArray<AsRead.Note>
    readonly changeChannel: string | null
  } | null
}

const draftCard = (
  input: ThreadInput,
  item: Extract<ThreadItem, { type: 'drafts' }>,
  draft: AsRead.Note,
  room: AsRead.Conversation | undefined,
  archived: boolean,
  channel: AsRead.Channel | null,
): DraftCard => {
  const teachingOn = isOn(input, 'teaching')
  const careful = carefulReadingFor(draft.body, approvesQuicklyOften(input.agentReport))
  return {
    draft,
    focused: draft.id === input.focusedDraft,
    origin: { className: `origin is-${draft.origin}`, text: originText(draft) },
    body: draft.body,
    basis: draftBasisOf(draft, showsAppliedMarkers(input.taught, teachingOn)),
    applied: appliedModel(draft, input.taught, teachingOn),
    destination:
      archived || room === undefined ? null : destinationOf(input, input.me.member.id, draft, room, channel),
    careful:
      !archived && isOn(input, 'agentFigures') && careful !== null ? strings.carefulReading[careful] : null,
    readAgain:
      !archived && isChangedSinceRead(input.draftsRead, draft)
        ? { notice: strings.draftChangedSinceRead, confirm: strings.draftReadAgain }
        : null,
    actions: archived
      ? null
      : {
          alternatives: alternativesLeftAfterSending(item, draft.id),
          changeChannel: channel === null ? null : channel.slug,
        },
  }
}

const originText = (note: AsRead.Note): string => {
  const agent = agentNameOf(note)
  return note.origin === 'human' || agent === null
    ? strings.origin[note.origin]
    : strings.originNamed[note.origin]({ agent })
}

const destinationOf = (
  input: Pick<ThreadInput, 'thread' | 'members'>,
  meId: MemberId,
  draft: AsRead.Note,
  room: AsRead.Conversation,
  channel: AsRead.Channel | null,
): DraftCard['destination'] => {
  if (channel !== null)
    return { kind: 'channel', text: strings.sendsToChannel({ channel: channelLabel(channel.slug) }), channel }
  const destination = draftDestination(room, draft, notesOf(input), meId)
  const names = listOf(destination.memberIds.map((memberId: MemberId) => nameIn(input, memberId)))
  return {
    kind: 'people',
    text:
      room.kind === 'channel'
        ? strings.sendsToInRoom({
            names,
            room: conversationTitle(room, input.members, meId, ''),
          })
        : strings.sendsTo({ names }),
  }
}

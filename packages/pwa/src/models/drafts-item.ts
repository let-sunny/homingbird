import type { AsRead, ConversationId, MemberId } from '@homingbird/protocol'
import { agentNameOf } from '../agent-names.ts'
import { approvesQuicklyOften, carefulReadingFor } from '../careful-reading.ts'
import { channelLabel, channelOfRoom } from '../channels.ts'
import { type DraftBasis, draftBasisOf } from '../draft-basis.ts'
import { isChangedSinceRead } from '../drafts-read.ts'
import { type HeldChoices, heldWordsFor, keptEditLine } from '../held-decisions.ts'
import { hrefFor } from '../routes.ts'
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
    moved: { destination: destination?.shown?.text ?? null, confirm: strings.draftConfirmRoom },
  }
}

/**
 * Whether the draft an editor started from still waits as it was read, so that the edit may be held for
 * sending; otherwise the editor shows what changed first.
 */
export const isUnchangedWhileEditing = (input: EditorInput, read: AsRead.Note): boolean =>
  [...input.threads.values()]
    .flatMap((thread) => thread.notes)
    .some(
      (note) =>
        note.id === read.id &&
        note.status === 'draft' &&
        note.body === read.body &&
        note.conversationId === read.conversationId,
    )

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
  /** What the agent based the draft on; null where no agent of the person's wrote it alone. */
  readonly basis: DraftBasis | null
  /** The debate room a posted result came from, in place of a basis. */
  readonly room: { readonly href: string; readonly label: string } | null
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
    readonly send: string
    readonly alternatives: ReadonlyArray<AsRead.Note>
    readonly changeChannel: string | null
    /** What the card's place and the toast say while a send or discard is held, and after. */
    readonly held: HeldChoices
    /** The text Edit opens with: the person's kept edit, or the draft as it stands. */
    readonly editText: string
  } | null
  /** Said when the person edited the draft and did not send the edit; Approve and send sends the draft as shown. */
  readonly keptEdit: string | null
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
  const destination =
    archived || room === undefined ? null : destinationOf(input, input.me.member.id, draft, room, channel)
  return {
    draft,
    focused: draft.id === input.focusedDraft,
    origin: {
      className: draft.fromDebate === undefined ? `origin is-${draft.origin}` : 'origin is-debate',
      text: originText(draft),
    },
    body: draft.body,
    basis: hasAgentBasis(draft) ? draftBasisOf(draft, showsAppliedMarkers(input.taught, teachingOn)) : null,
    room:
      draft.fromDebate === undefined
        ? null
        : {
            href: hrefFor({ name: 'debate', id: draft.fromDebate.debateId, tab: 'result' }),
            label: strings.debateNote.openRoom,
          },
    applied: appliedModel(draft, input.taught, teachingOn),
    destination: destination === null ? null : destination.shown,
    careful:
      !archived && isOn(input, 'agentFigures') && careful !== null ? strings.carefulReading[careful] : null,
    readAgain:
      !archived && isChangedSinceRead(input.draftsRead, draft)
        ? { notice: strings.draftChangedSinceRead, confirm: strings.draftReadAgain }
        : null,
    actions: archived
      ? null
      : {
          send: strings.approveAndSend,
          alternatives: alternativesLeftAfterSending(item, draft.id),
          changeChannel: channel === null ? null : channel.slug,
          held: heldWordsFor(destination?.names ?? strings.formerMember),
          editText: input.draftEdits.get(draft.id) ?? draft.body,
        },
    keptEdit: archived ? null : keptEditLine(input.draftEdits, draft.id),
  }
}

const originText = (note: AsRead.Note): string => {
  if (note.fromDebate !== undefined) return strings.debateNote.origin({ question: note.fromDebate.question })
  const agent = agentNameOf(note)
  return note.origin === 'human' || agent === null
    ? strings.origin[note.origin]
    : strings.originNamed[note.origin]({ agent })
}

/** A person's own words and a debate room's result have no agent of the person's behind them to give a basis. */
const hasAgentBasis = (note: AsRead.Note): boolean => note.origin !== 'human' && note.fromDebate === undefined

const destinationOf = (
  input: Pick<ThreadInput, 'thread' | 'members'>,
  meId: MemberId,
  draft: AsRead.Note,
  room: AsRead.Conversation,
  channel: AsRead.Channel | null,
): { readonly shown: DraftCard['destination']; readonly names: string } => {
  if (channel !== null) {
    const label = channelLabel(channel.slug)
    return {
      shown: { kind: 'channel', text: strings.sendsToChannel({ channel: label }), channel },
      names: label,
    }
  }
  const destination = draftDestination(room, draft, notesOf(input), meId)
  const names = listOf(destination.memberIds.map((memberId: MemberId) => nameIn(input, memberId)))
  return {
    shown: {
      kind: 'people',
      text:
        room.kind === 'channel'
          ? strings.sendsToInRoom({
              names,
              room: conversationTitle(room, input.members, meId, ''),
            })
          : strings.sendsTo({ names }),
    },
    names,
  }
}

import type {
  AsRead,
  ConversationId,
  DraftAsShown,
  DraftRequest,
  MemberId,
  NoteId,
  Presence,
} from '@homingbird/protocol'
import { channelLabel, channelOfRoom } from '../channels.ts'
import { featureOn } from '../features.ts'
import type { ArchiveDiscard, Release, Thread } from '../state.ts'
import { strings } from '../strings.ts'
import { conversationTitle, isArchived, otherParticipants } from '../thread.ts'
import { privateQuestionNotice } from './channel-agent.ts'
import { type MuteToggle, muteToggleModel } from './mute-toggle.ts'

/** What every part of a conversation's page reads: the room, its notes, the people and the person. */
export interface ThreadInput {
  readonly me: AsRead.Me
  readonly conversationId: ConversationId
  readonly thread: Thread | undefined
  readonly draftsRead: ReadonlyMap<NoteId, DraftAsShown>
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly releases: ReadonlyMap<NoteId, Release>
  readonly archiveDiscards: ReadonlyArray<ArchiveDiscard>
  readonly replyTarget: NoteId | null
  readonly draftRequests: ReadonlyArray<DraftRequest>
  readonly taught: AsRead.MyPrinciples | 'failed' | null
  readonly agentReport: AsRead.AgentReport | 'failed' | null
  readonly serverInfo: AsRead.ServerInfo | null
  readonly sending: boolean
  readonly now: number
}

/** The notes of the conversation shown. */
export const notesOf = (input: Pick<ThreadInput, 'thread'>): ReadonlyArray<AsRead.Note> =>
  input.thread?.notes ?? []

export const noteIn = (input: Pick<ThreadInput, 'thread'>, noteId: string | null): AsRead.Note | null =>
  notesOf(input).find((note) => note.id === noteId) ?? null

export const roomOf = (
  input: Pick<ThreadInput, 'conversations' | 'conversationId'>,
): AsRead.Conversation | undefined =>
  input.conversations.find((candidate) => candidate.id === input.conversationId)

export const nameIn = (input: Pick<ThreadInput, 'members'>, memberId: MemberId): string =>
  input.members.get(memberId)?.name ?? strings.formerMember

export const isOn = (
  input: Pick<ThreadInput, 'serverInfo'>,
  name: Parameters<typeof featureOn>[0],
): boolean => featureOn(name, input.serverInfo)

/** Above the notes: a way to load older ones, or what to do in a conversation that has none yet. */
export const threadTopModel = (input: ThreadInput): ThreadTop => {
  const thread = input.thread
  if (thread === undefined) return { kind: 'loading' }
  if (thread.hasMore) return { kind: 'older', label: strings.loadOlder }
  if (thread.notes.length > 0) return { kind: 'none' }
  return {
    kind: 'empty',
    text:
      privateQuestionNotice(roomOf(input), input.channels) ??
      (roomOf(input)?.kind === 'channel' ? strings.channelRoomEmpty : strings.emptyThread),
  }
}

/** Below the notes: each draft that archiving the channel discarded, in the person's own words. */
export const archiveDiscardLines = (
  discards: ReadonlyArray<ArchiveDiscard>,
): ReadonlyArray<{ readonly noteId: NoteId; readonly text: string }> =>
  discards.map((discard) => ({
    noteId: discard.noteId,
    text: strings.draftDiscardedByArchive({ channel: channelLabel(discard.channel) }),
  }))

/** The head of a conversation: who it is with, or the channel with its counts and controls. */
export const threadHeadModel = (input: ThreadInput): ThreadHead => {
  const conversation = roomOf(input)
  if (conversation === undefined) return { kind: 'loading', title: strings.loading }
  const title = conversationTitle(conversation, input.members, input.me.member.id, strings.formerMember)
  const archived = isArchived(conversation)
  const mute = muteToggleModel(conversation, title, isOn(input, 'mute'))
  if (conversation.kind === 'channel' || archived)
    return {
      kind: 'channel',
      title,
      archived,
      channel: archived ? null : channelOfRoom(input.channels, conversation.id),
      mute,
    }
  const others = otherParticipants(conversation, input.me.member.id)
  const entry =
    conversation.kind === 'direct'
      ? input.directory.find((candidate) => candidate.member.id === others[0])
      : undefined
  return {
    kind: 'people',
    title,
    profile: privateQuestionNotice(conversation, input.channels) ?? entry?.member.profile ?? null,
    presence: entry?.presence ?? null,
    mute,
  }
}

/** Whether the person may write here: a direct conversation with someone who does not take their notes may not. */
export const mayMessageIn = (input: ThreadInput): boolean => {
  const conversation = roomOf(input)
  if (conversation === undefined || conversation.kind !== 'direct') return true
  const other = otherParticipants(conversation, input.me.member.id)[0]
  const entry = input.directory.find((candidate) => candidate.member.id === other)
  return entry === undefined || entry.canMessage
}

export type ThreadTop =
  | { readonly kind: 'loading' }
  | { readonly kind: 'older'; readonly label: string }
  | { readonly kind: 'empty'; readonly text: string }
  | { readonly kind: 'none' }

export type ThreadHead =
  | { readonly kind: 'loading'; readonly title: string }
  | {
      readonly kind: 'channel'
      readonly title: string
      readonly archived: boolean
      readonly channel: AsRead.Channel | null
      readonly mute: MuteToggle | null
    }
  | {
      readonly kind: 'people'
      readonly title: string
      readonly profile: string | null
      readonly presence: Presence | null
      readonly mute: MuteToggle | null
    }

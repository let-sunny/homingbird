import type {
  AsRead,
  ConversationId,
  DraftAsShown,
  DraftRequest,
  MemberId,
  NoteId,
} from '@homingbird/protocol'
import { type ChannelAgentState, channelAgentState } from '../channel-answerers.ts'
import { channelLabel, channelOfRoom } from '../channels.ts'
import { featureOn } from '../features.ts'
import { type PresenceMarks, presenceMarks } from '../presence.ts'
import type { ArchiveDiscard, Release, Thread } from '../state.ts'
import { strings } from '../strings.ts'
import { conversationTitle, isArchived, otherParticipants } from '../thread.ts'
import { privateQuestionNotice, privateQuestionStart } from './channel-agent.ts'
import { type MuteToggle, muteToggleModel } from './mute-toggle.ts'
import { type Participants, conversationParticipants } from './participants.ts'

/** What every part of a conversation's page reads: the room, its notes, the people and the person. */
export interface ThreadInput {
  readonly me: AsRead.Me
  readonly conversationId: ConversationId
  readonly thread: Thread | undefined
  readonly draftsRead: ReadonlyMap<NoteId, DraftAsShown>
  /** The edits the person made to drafts and did not send, by draft. */
  readonly draftEdits: ReadonlyMap<NoteId, string>
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly releases: ReadonlyMap<NoteId, Release>
  readonly archiveDiscards: ReadonlyArray<ArchiveDiscard>
  /** Questions whose channel agent's answer this manager discarded, with the agent's name. */
  readonly discardedAnswers?: ReadonlyMap<NoteId, string>
  readonly replyTarget: NoteId | null
  readonly draftRequests: ReadonlyArray<DraftRequest>
  readonly taught: AsRead.MyPrinciples | 'failed' | null
  readonly agentReport: AsRead.AgentReport | 'failed' | null
  readonly serverInfo: AsRead.ServerInfo | null
  readonly sending: boolean
  readonly now: number
  /** The draft a link opened the conversation at; an id that names no draft shown here focuses nothing. */
  readonly focusedDraft: string | null
  /** The words of others' agents' drafts this page showed early, by note. */
  readonly previewedBodies: ReadonlyMap<NoteId, string>
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
  const room = roomOf(input)
  if (room?.privateQuestionOf !== undefined)
    return { kind: 'empty', text: privateQuestionStart(room, input.channels) ?? strings.emptyThread }
  return { kind: 'empty', text: room?.kind === 'channel' ? strings.channelRoomEmpty : strings.emptyThread }
}

/**
 * Why the draft a notification opened is not shown: it was sent or discarded on another device before
 * this page opened. A draft this page showed open and that then went was settled here, so it says
 * nothing.
 */
export const settledDraftLine = (
  input: Pick<ThreadInput, 'thread' | 'focusedDraft'>,
  wasShownOpen: boolean,
): string | null =>
  input.focusedDraft === null || input.thread === undefined || wasShownOpen || isFocusedDraftOpen(input)
    ? null
    : strings.draftAlreadySettled

/** Whether the draft a link opened is in the conversation, still waiting for the person. */
export const isFocusedDraftOpen = (input: Pick<ThreadInput, 'thread' | 'focusedDraft'>): boolean =>
  notesOf(input).some((note) => note.id === input.focusedDraft && note.status === 'draft')

/** Below the notes: each draft that archiving the channel discarded, in the person's own words. */
export const archiveDiscardLines = (
  discards: ReadonlyArray<ArchiveDiscard>,
): ReadonlyArray<{ readonly noteId: NoteId; readonly text: string }> =>
  discards.map((discard) => ({
    noteId: discard.noteId,
    text: strings.draftDiscardedByArchive({ channel: channelLabel(discard.channel) }),
  }))

/** The channel a question here is asked of: the channel's own room, or a question asked of its agent privately. */
export const channelAskedIn = (
  input: Pick<ThreadInput, 'conversations' | 'conversationId' | 'channels'>,
): AsRead.Channel | null => {
  const room = roomOf(input)
  if (room === undefined || isArchived(room)) return null
  if (room.kind === 'channel') return channelOfRoom(input.channels, room.id)
  const slug = room.privateQuestionOf ?? null
  return slug === null ? null : (input.channels.find((channel) => channel.slug === slug) ?? null)
}

/** The name of the scrolling list of a conversation's notes, for a screen reader: whose notes they are. */
export const threadNotesLabel = (input: ThreadInput): string =>
  strings.threadNotes({ title: threadHeadModel(input).title })

/** The head of a conversation: who it is with, or the channel with its counts and controls. */
export const threadHeadModel = (input: ThreadInput): ThreadHead => {
  const conversation = roomOf(input)
  if (conversation === undefined) return { kind: 'loading', title: strings.loading }
  const title = conversationTitle(conversation, input.members, input.me.member.id, strings.formerMember)
  const archived = isArchived(conversation)
  const mute = muteToggleModel(conversation, title, isOn(input, 'mute'))
  const participants = conversationParticipants({
    conversation,
    viewerId: input.me.member.id,
    members: input.members,
    channels: input.channels,
  })
  if (conversation.kind === 'channel' || archived) {
    const channel = archived ? null : channelOfRoom(input.channels, conversation.id)
    const agent = isOn(input, 'channelAgents') ? (channel?.agent ?? null) : null
    return {
      kind: 'channel',
      title,
      archived,
      channel,
      agentState: agent === null ? null : channelAgentState(agent),
      people:
        channel === null
          ? participants
          : { ...participants, label: strings.memberCount({ count: channel.memberCount }) },
      answerCount: channel === null ? null : strings.answerCount({ count: channel.helperCount }),
      slackLink: slackLinkLine(channel),
      mute,
    }
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
    presence: entry === undefined ? null : presenceMarks(entry.presence, entry.member.name),
    people: participants,
    showsCount: conversation.kind !== 'direct',
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
      /** The channel's agent's state, as a person's agent is shown. */
      readonly agentState: ChannelAgentState | null
      /** Everyone in the room, listed behind its member count. */
      readonly people: Participants
      readonly answerCount: string | null
      /** The Slack channel linked to this one, and whether the person may unlink it. */
      readonly slackLink: { readonly text: string; readonly unlink: string | null } | null
      readonly mute: MuteToggle | null
    }
  | {
      readonly kind: 'people'
      readonly title: string
      readonly profile: string | null
      /** A direct message's colleague and their agent, each named, as small marks. */
      readonly presence: PresenceMarks | null
      /** Everyone in it, listed behind its names and, outside a direct message, a count. */
      readonly people: Participants
      readonly showsCount: boolean
      readonly mute: MuteToggle | null
    }

const slackLinkLine = (
  channel: AsRead.Channel | null,
): Extract<ThreadHead, { kind: 'channel' }>['slackLink'] => {
  const link = channel?.link
  if (link === undefined || link === null) return null
  return {
    text:
      link.state === 'active'
        ? strings.slack.linkedChannel({ channel: link.name })
        : strings.slack.linkStopped({ channel: link.name }),
    unlink: channel?.managing === true ? strings.slack.unlinkChannel : null,
  }
}

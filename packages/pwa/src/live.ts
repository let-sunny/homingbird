import { Task as T, systemClock } from '@homingbird/kernel'
import type { StreamEvent } from '@homingbird/protocol'
import {
  forgetNote,
  forgetRelease,
  launch,
  loadAgents,
  loadChannels,
  loadConversations,
  loadPeople,
  loadThread,
  loadWorkspace,
  rememberNote,
} from './actions.ts'
import { channelLabel, withChannel, withoutRoom } from './channels.ts'
import { upsertRequest } from './draft-requests.ts'
import { hrefFor } from './routes.ts'
import {
  agentCredentials,
  announcement,
  archiveDiscards,
  channels,
  conversations,
  directory,
  draftRequests,
  members,
  notice,
  releases,
  route,
  signedIn,
  threads,
} from './state.ts'
import { strings } from './strings.ts'
import { countChange } from './thread-changes.ts'
import { withPresence, withReceipts, withoutMovedQuestion } from './thread.ts'

export const applyEvent = (event: StreamEvent): void => {
  const body = event.body
  switch (body.type) {
    case 'note.sent':
      rememberNote(body.note)
      announceIfFresh(event)
      launch(loadConversations)
      break
    case 'note.status':
      countChange(body.conversationId)
      threads.update((all) => {
        const thread = all.get(body.conversationId)
        return thread === undefined
          ? all
          : new Map(all).set(body.conversationId, {
              ...thread,
              notes: withReceipts(thread.notes, body.noteId, body.receipts),
            })
      })
      break
    case 'note.moved':
      countChange(body.fromConversationId)
      countChange(body.toConversationId)
      threads.update((all) => withoutMovedQuestion(all, body.fromConversationId, body.noteId))
      launch(loadConversations)
      break
    case 'draft.saved':
      rememberNote(body.note)
      if (body.note.inReplyTo !== null) forgetRelease(body.note.inReplyTo)
      if (body.note.origin !== 'human') refreshAgentsIfNoneKnown()
      launch(loadConversations)
      break
    case 'draft.discarded':
      forgetNote(body.conversationId, body.noteId)
      if (body.because === 'channel_archived' && body.channel !== undefined) {
        const channel = body.channel
        archiveDiscards.update((all) =>
          new Map(all).set(body.conversationId, [
            ...(all.get(body.conversationId) ?? []).filter((one) => one.noteId !== body.noteId),
            { noteId: body.noteId, channel },
          ]),
        )
        notice.set({
          kind: 'info',
          text: strings.draftDiscardedByArchive({ channel: channelLabel(channel) }),
        })
      }
      launch(loadConversations)
      break
    case 'note.released':
      releases.update((all) =>
        new Map(all).set(body.noteId, { reason: body.reason, agentName: body.agentName }),
      )
      launch(loadThread(body.conversationId))
      break
    case 'draft.requested':
    case 'draft.request.changed':
      draftRequests.update((all) => upsertRequest(all, body.request))
      break
    case 'contact.changed':
      launch(loadPeople)
      break
    case 'directory.changed':
      reloadDirectorySoon()
      break
    case 'channel.changed':
      channels.update((all) => withChannel(all, body.channel))
      if (body.channel.joined) launch(loadConversations)
      break
    case 'channel.left':
      channels.update((all) => withoutRoom(all, body.conversationId, signedIn()?.member.role === 'admin'))
      conversations.update((all) => all.filter((room) => room.id !== body.conversationId))
      countChange(body.conversationId)
      threads.update((all) => {
        const remaining = new Map(all)
        remaining.delete(body.conversationId)
        return remaining
      })
      leaveRoomIfShown(body.conversationId)
      break
    case 'presence':
      directory.update((entries) => withPresence(entries, body.members))
      if (body.members.some((change) => change.memberId === signedIn()?.member.id && change.agentOnline))
        refreshAgentsIfNoneKnown()
      break
    case 'resync':
      reloadEverything()
      break
  }
}

const leaveRoomIfShown = (conversationId: string): void => {
  const current = route.get()
  if (current.name === 'conversation' && current.id === conversationId)
    location.replace(hrefFor({ name: 'channels' }))
}

const FRESH_MS = 30_000
const DIRECTORY_SETTLE_MS = 400

let directoryReload: ReturnType<typeof setTimeout> | undefined

const reloadDirectorySoon = (): void => {
  clearTimeout(directoryReload)
  directoryReload = setTimeout(
    () => launch(T.all([loadPeople, loadChannels(''), loadConversations])),
    DIRECTORY_SETTLE_MS,
  )
}

const announceIfFresh = (event: StreamEvent): void => {
  if (event.body.type !== 'note.sent') return
  const { note } = event.body
  const isMine = note.authorId === signedIn()?.member.id
  const isFresh = systemClock.now() - (note.sentAt ?? 0) < FRESH_MS
  if (isMine || !isFresh) return
  announcement.set(
    strings.incomingNote({ name: members.get().get(note.authorId)?.name ?? strings.formerMember }),
  )
}

const refreshAgentsIfNoneKnown = (): void => {
  if (agentCredentials.get().length === 0) launch(loadAgents)
}

const reloadEverything = (): void => {
  launch(loadWorkspace)
  const current = route.get()
  if (current.name === 'conversation') launch(loadThread(current.id as never))
}

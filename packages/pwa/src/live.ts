import { systemClock } from '@homingbird/kernel'
import type { StreamEvent } from '@homingbird/protocol'
import {
  forgetNote,
  launch,
  loadConversations,
  loadPeople,
  loadThread,
  loadWorkspace,
  rememberNote,
} from './actions.ts'
import { upsertRequest } from './draft-requests.ts'
import { announcement, directory, draftRequests, members, route, signedIn, threads } from './state.ts'
import { strings } from './strings.ts'
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
      threads.update((all) => withoutMovedQuestion(all, body.fromConversationId, body.noteId))
      launch(loadConversations)
      break
    case 'draft.saved':
      rememberNote(body.note)
      launch(loadConversations)
      break
    case 'draft.discarded':
      forgetNote(body.conversationId, body.noteId)
      launch(loadConversations)
      break
    case 'draft.requested':
    case 'draft.request.changed':
      draftRequests.update((all) => upsertRequest(all, body.request))
      break
    case 'contact.changed':
      launch(loadPeople)
      break
    case 'directory.changed':
      reloadPeopleSoon()
      break
    case 'presence':
      directory.update((entries) => withPresence(entries, body.members))
      break
    case 'resync':
      reloadEverything()
      break
  }
}

const FRESH_MS = 30_000
const DIRECTORY_SETTLE_MS = 400

let directoryReload: ReturnType<typeof setTimeout> | undefined

const reloadPeopleSoon = (): void => {
  clearTimeout(directoryReload)
  directoryReload = setTimeout(() => launch(loadPeople), DIRECTORY_SETTLE_MS)
}

const announceIfFresh = (event: StreamEvent): void => {
  if (event.body.type !== 'note.sent') return
  const { note } = event.body
  const isMine = note.authorId === signedIn()?.member.id
  const isFresh = systemClock.now() - (note.sentAt ?? 0) < FRESH_MS
  if (isMine || !isFresh) return
  announcement.set(strings.incomingNote(members.get().get(note.authorId)?.name ?? strings.formerMember))
}

const reloadEverything = (): void => {
  launch(loadWorkspace)
  const current = route.get()
  if (current.name === 'conversation') launch(loadThread(current.id as never))
}

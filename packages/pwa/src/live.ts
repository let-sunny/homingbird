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
import { announcement, directory, members, route, signedIn, threads } from './state.ts'
import { strings } from './strings.ts'
import { withReceipts } from './thread.ts'

export const applyEvent = (event: StreamEvent): void => {
  const body = event.body
  switch (body.type) {
    case 'note.sent':
      rememberNote(body.note)
      announceIfFresh(event)
      return launch(loadConversations)
    case 'note.status':
      return threads.update((all) => {
        const thread = all.get(body.conversationId)
        return thread === undefined
          ? all
          : new Map(all).set(body.conversationId, {
              ...thread,
              notes: withReceipts(thread.notes, body.noteId, body.receipts),
            })
      })
    case 'draft.saved':
      rememberNote(body.note)
      return launch(loadConversations)
    case 'draft.discarded':
      forgetNote(body.conversationId, body.noteId)
      return launch(loadConversations)
    case 'contact.changed':
      return launch(loadPeople)
    case 'directory.changed':
      return reloadPeopleSoon()
    case 'presence': {
      const changed = new Map(body.members.map((member) => [member.memberId, member]))
      return directory.update((entries) =>
        entries.map((entry) => {
          const presence = changed.get(entry.member.id)
          return presence === undefined
            ? entry
            : { ...entry, presence: { humanOnline: presence.humanOnline, agentOnline: presence.agentOnline } }
        }),
      )
    }
    case 'resync':
      return reloadEverything()
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

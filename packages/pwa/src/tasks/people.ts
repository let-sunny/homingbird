import { Task as T } from '@homingbird/kernel'
import type { AsRead, MemberId } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'
import { hrefFor } from '../routes.ts'
import { loadPeople } from './workspace.ts'

/** Opens the direct conversation with a member, starting it when there is none yet. */
export const openConversationWith = (memberId: MemberId): Action => openConversationAmong([memberId])

/**
 * Starts a conversation with everyone chosen and opens it; with one person it is the direct
 * conversation. Nothing is sent: the first note is drafted and approved there like any other.
 */
export const openConversationAmong = (memberIds: ReadonlyArray<MemberId>): Action =>
  withApp(({ api, state, page }) =>
    T.map((conversation: AsRead.Conversation) => {
      state.conversations.update((list) =>
        list.some((c) => c.id === conversation.id) ? list : [conversation, ...list],
      )
      page.go(hrefFor({ name: 'conversation', id: conversation.id }))
    })(api['conversations.create']({ body: { participantIds: [...memberIds] } })),
  )

export const requestContact = (memberId: MemberId): Action =>
  withApp(({ api }) => T.flatMap(() => loadPeople)(api['contacts.request']({ body: { memberId } })))

export const acceptContact = (memberId: MemberId): Action =>
  withApp(({ api }) => T.flatMap(() => loadPeople)(api['contacts.accept']({ params: { memberId } })))

export const removeContact = (memberId: MemberId): Action =>
  withApp(({ api }) => T.flatMap(() => loadPeople)(api['contacts.remove']({ params: { memberId } })))

export const blockMember = (memberId: MemberId): Action =>
  withApp(({ api }) => T.flatMap(() => loadPeople)(api['blocks.add']({ params: { memberId } })))

export const unblockMember = (memberId: MemberId): Action =>
  withApp(({ api }) => T.flatMap(() => loadPeople)(api['blocks.remove']({ params: { memberId } })))

/** Notes matching what the person searched for, among those they may read. */
export const searchNotes = (query: string): Action<ReadonlyArray<AsRead.Note>> =>
  withApp(({ api }) =>
    T.map((found: { notes: ReadonlyArray<AsRead.Note> }) => found.notes)(
      api['search.notes']({ query: { q: query } }),
    ),
  )

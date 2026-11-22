import { Task as T } from '@homingbird/kernel'
import type { AsRead, ConversationId, CredentialId, MemberId } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { hrefFor } from '../routes.ts'
import { signedIn } from '../state.ts'
import { roomWith } from '../thread.ts'
import { askAgent } from './drafts.ts'
import { sendNote } from './notes.ts'
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
      page.go(hrefFor({ name: 'conversation', id: conversation.id, draft: null }))
    })(api['conversations.create']({ body: { participantIds: [...memberIds] } })),
  )

/**
 * Sends a first note to the people chosen on the new-message screen and opens where it went: the room
 * there already is with exactly them, or one made now, so a screen left before sending leaves no room.
 */
export const sendNoteAmong = (memberIds: ReadonlyArray<MemberId>, body: string): Action =>
  T.gen(function* () {
    const { page } = yield* T.ask<App>()
    const id = yield* roomAmong(memberIds)
    yield* sendNote(id, body)
    page.go(hrefFor({ name: 'conversation', id, draft: null }))
  })

/** Asks the person's agent to draft a first note to the people chosen, in their room, made now if need be. */
export const askAgentAmong = (
  memberIds: ReadonlyArray<MemberId>,
  instruction: string,
  agentId: CredentialId | null,
): Action =>
  T.gen(function* () {
    const { page } = yield* T.ask<App>()
    const conversationId = yield* roomAmong(memberIds)
    yield* askAgent({ destination: { conversationId }, instruction, agentId })
    page.go(hrefFor({ name: 'conversation', id: conversationId, draft: null }))
  })

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

const roomAmong = (memberIds: ReadonlyArray<MemberId>): Action<ConversationId> =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    const viewerId = signedIn(state)?.member.id
    const existing =
      viewerId === undefined ? undefined : roomWith(state.conversations.get(), viewerId, memberIds)
    if (existing !== undefined) return existing.id
    const created = yield* api['conversations.create']({ body: { participantIds: [...memberIds] } })
    state.conversations.update((list) => (list.some((c) => c.id === created.id) ? list : [created, ...list]))
    return created.id
  })

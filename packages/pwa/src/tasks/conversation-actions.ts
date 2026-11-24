import { Task as T } from '@homingbird/kernel'
import type { AsRead, ConversationId, MemberId } from '@homingbird/protocol'
import type { Action, App } from '../app.ts'
import { hrefFor } from '../routes.ts'
import { signedIn } from '../state.ts'

/**
 * Hides a conversation from the person's own list, or shows it again, and shows the answer at once. A
 * conversation hidden while it is open closes, as it would from the list, and the page says how it
 * comes back.
 */
export const setHidden = (conversationId: ConversationId, hidden: boolean, done: string | null): Action =>
  T.gen(function* () {
    const app = yield* T.ask<App>()
    const request = { params: { id: conversationId } }
    const conversation = hidden
      ? yield* app.api['conversations.hide'](request)
      : yield* app.api['conversations.unhide'](request)
    app.state.conversations.update((list) =>
      list.map((each) =>
        each.id === conversation.id ? { ...each, hidden: conversation.hidden === true } : each,
      ),
    )
    if (conversation.hidden !== true) return
    closeIfShown(app, conversationId)
    if (done !== null) app.state.notice.set({ kind: 'info', text: done })
  })

/** Leaves a group message for good: it goes from every list and page at once, and the page says so. */
export const leaveGroup = (conversationId: ConversationId, done: string): Action =>
  T.gen(function* () {
    const app = yield* T.ask<App>()
    yield* app.api['conversations.leave']({ params: { id: conversationId } })
    forgetConversation(app, conversationId)
    app.state.notice.set({ kind: 'info', text: done })
  })

/**
 * What a `conversation.left` event changes: the person's own leave, from this device or another, drops
 * the room; someone else's takes them out of its people, so a card names only who will read it.
 */
export const applyLeft = (app: App, conversationId: ConversationId, memberId: MemberId): void => {
  if (memberId === signedIn(app.state)?.member.id) {
    forgetConversation(app, conversationId)
    return
  }
  app.state.conversations.update((list) =>
    list.map((each) => withoutParticipant(each, conversationId, memberId)),
  )
  app.state.changes.count(conversationId)
}

const forgetConversation = (app: App, conversationId: ConversationId): void => {
  app.state.conversations.update((list) => list.filter((each) => each.id !== conversationId))
  app.state.threads.update((all) => {
    if (!all.has(conversationId)) return all
    const remaining = new Map(all)
    remaining.delete(conversationId)
    return remaining
  })
  app.state.changes.count(conversationId)
  closeIfShown(app, conversationId)
}

const closeIfShown = (app: App, conversationId: ConversationId): void => {
  const current = app.state.route.get()
  if (current.name === 'conversation' && current.id === conversationId)
    app.page.replace(hrefFor({ name: 'home' }))
}

const withoutParticipant = (
  conversation: AsRead.Conversation,
  conversationId: ConversationId,
  memberId: MemberId,
): AsRead.Conversation =>
  conversation.id !== conversationId
    ? conversation
    : { ...conversation, participantIds: conversation.participantIds.filter((id) => id !== memberId) }

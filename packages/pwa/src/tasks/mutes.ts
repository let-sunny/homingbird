import { Task as T } from '@homingbird/kernel'
import type { ConversationId, NOTIFICATION_LEVELS } from '@homingbird/protocol'
import type { Action, App } from '../app.ts'
import { signedIn } from '../state.ts'

/** Mutes a conversation for the person, or lifts the mute, and shows the answer in the list at once. */
export const setMuted = (conversationId: ConversationId, muted: boolean): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    const request = { params: { id: conversationId } }
    const conversation = muted
      ? yield* api['conversations.mute'](request)
      : yield* api['conversations.unmute'](request)
    state.conversations.update((list) =>
      list.map((each) =>
        each.id === conversation.id ? { ...each, muted: conversation.muted === true } : each,
      ),
    )
  })

/** Saves which conversations may send the person notifications on their devices. */
export const chooseNotificationLevel = (level: (typeof NOTIFICATION_LEVELS)[number]): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    const saved = yield* api['me.notifications.set']({ body: { notifications: level } })
    const me = signedIn(state)
    if (me !== null) state.session.set({ ...me, notifications: saved.notifications })
  })

import { Task as T } from '@homingbird/kernel'
import type { AsRead, ConversationId } from '@homingbird/protocol'
import { threadsForActivity } from '../activity.ts'
import { type Action, type App, withApp } from '../app.ts'
import { featureOn } from '../features.ts'
import { loadReviews } from './channel-agents.ts'
import { loadDebates } from './debates.ts'
import { loadThread } from './notes.ts'

/**
 * Loads what the activity panel lists: the conversations with the person's drafts or with notes waiting
 * for their reply, the answers they review and the debate rooms. A part that fails is left as it was.
 */
export const loadActivity: Action = T.gen(function* () {
  const { api, state } = yield* T.ask<App>()
  const inbox = yield* T.result(api['inbox.list']({ query: {} }))
  const awaiting =
    inbox._tag === 'Ok' ? inbox.value.items.map((item: AsRead.InboxItem) => item.conversation.id) : []
  yield* T.all([
    loadThreads(awaiting),
    T.result(loadReviews),
    featureOn('debateRooms', state.serverInfo.get()) ? T.result(loadDebates) : T.unit,
  ])
})

/** Loads the conversations that got the person's drafts since the panel was opened. */
export const loadDraftThreads: Action = withApp(() => loadThreads([]))

const loadThreads = (awaiting: ReadonlyArray<ConversationId>): Action =>
  withApp(({ state }) => {
    const wanted = threadsForActivity(
      state.conversations.get(),
      state.threads.get(),
      awaiting,
      state.threadsLoading,
    )
    for (const id of wanted) state.threadsLoading.add(id)
    return T.asUnit(
      T.all(
        wanted.map((id) =>
          T.ensuring(T.sync(() => state.threadsLoading.delete(id)))(T.result(loadThread(id))),
        ),
      ),
    )
  })

import { Task as T } from '@homingbird/kernel'
import type { ConversationId } from '@homingbird/protocol'
import { threadsForActivity } from '../activity.ts'
import { type Action, type App, withApp } from '../app.ts'
import type { AppState } from '../state.ts'
import { loadThread } from './notes.ts'
import { type ResourceKey, again, invalidate, open } from './resources.ts'

/**
 * Opens what the activity lists: the answers the person reviews, the suggestions and the flocks, and the
 * conversations with their drafts or with notes waiting for their reply. It never fails: the list says so.
 */
export const loadActivity: Action = T.asUnit(
  T.all([
    T.flatMap(() => loadAwaitedThreads)(open('awaitingReply')),
    open('reviews', 'suggestions', 'debates'),
  ]),
)

/** Asks for every list of the activity once more, as when changes may have been missed. */
export const invalidateActivity: Action = T.suspend(() => invalidate(...ACTIVITY))

/** Asks afresh for the lists of the activity that failed or take too long. */
export const askActivityAgain: Action = withApp(({ state }) =>
  again(...ACTIVITY.filter((key) => isStuck(state, key))),
)

export const loadAwaitedThreads: Action = withApp(({ state }) =>
  T.suspend(() => loadThreads(state.awaitingReply.get())),
)

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

const ACTIVITY: ReadonlyArray<ResourceKey> = ['awaitingReply', 'reviews', 'suggestions', 'debates']

const isStuck = (state: AppState, key: ResourceKey): boolean => {
  const { step } = state[key].load.get()
  return step === 'long' || step === 'failed'
}

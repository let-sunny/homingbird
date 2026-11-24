import { Task as T } from '@homingbird/kernel'
import type { AsRead, ConversationId } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { featureOn } from '../features.ts'
import type { AppState } from '../state.ts'

/** The previews this person may see in a conversation; none while the organization has previews off. */
export const loadPreviews = (id: ConversationId): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    if (!featureOn('draftPreviews', state.serverInfo.get())) return
    const { previews } = yield* api['previews.list']({ params: { id } })
    state.previewedBodies.update((seen) => {
      const next = new Map(seen)
      for (const preview of previews)
        if (preview.state === 'unconfirmed' && preview.body !== null) next.set(preview.noteId, preview.body)
      return next
    })
    state.previews.update((all) => new Map(all).set(id, previews))
  })

/**
 * Reads again every conversation's previews this page holds, as when someone's allowance changed. One that
 * cannot be read does not stop the others. A conversation that answers not found or forbidden shows no
 * previews any more, nor remembers the words they showed (rule 2); any other failure keeps what was shown.
 */
export const reloadPreviews: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  for (const id of state.previews.get().keys()) {
    const outcome = yield* T.result(loadPreviews(id))
    if (outcome._tag === 'Ok') continue
    if (outcome.error._tag === 'Unauthorized') return yield* T.fail(outcome.error)
    if (outcome.error._tag === 'NotFound' || outcome.error._tag === 'Forbidden') forgetPreviews(state, id)
  }
})

const forgetPreviews = (state: AppState, id: ConversationId): void => {
  const lost = new Set((state.previews.get().get(id) ?? []).map((preview) => preview.noteId))
  state.previewedBodies.update((seen) => new Map([...seen].filter(([noteId]) => !lost.has(noteId))))
  state.previews.update((all) => {
    const remaining = new Map(all)
    remaining.delete(id)
    return remaining
  })
}

export const loadPreviewAllowance: Action<AsRead.DraftPreviewAllowance> = withApp(({ api, state }) =>
  T.map((allowance: AsRead.DraftPreviewAllowance) => {
    state.previewAllowance.set(allowance)
    return allowance
  })(api['me.draftPreviews.get']({})),
)

export const savePreviewAllowance = (
  allowance: AsRead.DraftPreviewAllowance,
): Action<AsRead.DraftPreviewAllowance> =>
  withApp(({ api, state }: App) =>
    T.map((stored: AsRead.DraftPreviewAllowance) => {
      state.previewAllowance.set(stored)
      return stored
    })(api['me.draftPreviews.set']({ body: allowance })),
  )

import { Task as T } from '@homingbird/kernel'
import type { AsRead, ConversationId } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { featureOn } from '../features.ts'

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

/** Reads again every conversation's previews this page holds, as when someone's allowance changed. */
export const reloadPreviews: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  for (const id of state.previews.get().keys()) yield* loadPreviews(id)
})

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

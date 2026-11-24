import { Task as T } from '@homingbird/kernel'
import type { AsRead, ConversationId } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { featureOn } from '../features.ts'
import type { AppState } from '../state.ts'

/**
 * The previews this person may see in a conversation; none while the organization has previews off. An
 * answer counts only while no later load or hide of the conversation began; the conversation counts as
 * held from the start, so a reconnect reads it even when this load never answers.
 */
export const loadPreviews = (id: ConversationId): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    if (!featureOn('draftPreviews', state.serverInfo.get())) return
    if (!state.previews.get().has(id)) state.previews.update((all) => new Map(all).set(id, []))
    state.previewReads.count(id)
    const started = state.previewReads.changesTo(id)
    const answered = yield* T.result(api['previews.list']({ params: { id } }))
    if (state.previewReads.changedSince(id, started)) return
    if (answered._tag === 'Err') return yield* T.fail(answered.error)
    const { previews } = answered.value
    state.previewedBodies.update((seen) => {
      const next = new Map(seen)
      for (const preview of previews)
        if (preview.state === 'unconfirmed' && preview.body !== null) next.set(preview.noteId, preview.body)
      return next
    })
    state.previews.update((all) => new Map(all).set(id, previews))
  })

/** Shows none of the conversations' previews, and forgets the words they showed, until a later load answers. */
export const hidePreviews = (state: AppState, ids: ReadonlyArray<ConversationId>): void => {
  for (const id of ids) state.previewReads.count(id)
  const held = state.previews.get()
  const hidden = new Set(ids.flatMap((id) => (held.get(id) ?? []).map((preview) => preview.noteId)))
  if (hidden.size === 0) return
  state.previewedBodies.update((seen) => new Map([...seen].filter(([noteId]) => !hidden.has(noteId))))
  state.previews.update((all) => new Map([...all, ...ids.map((id) => [id, []] as const)]))
}

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

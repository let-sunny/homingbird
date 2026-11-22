import { Task as T } from '@homingbird/kernel'
import type { NoteId } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { undoableHeld } from '../held-decisions.ts'
import { type AppState, type HeldDecision, signedIn } from '../state.ts'
import { forgetUnsettled, keepUnsettled, keptUnsettled } from '../unsettled-decisions.ts'

/**
 * Holds a send or discard on the page for a moment before it is asked of the server, so that the person
 * can undo it; one held already on another note is carried out first, since the person moved on from it. This browser
 * keeps it until the server answers, so that a page that dies meanwhile is told on its next load.
 */
export const holdDecision = (decision: Omit<HeldDecision, 'phase'>): Action =>
  T.gen(function* () {
    const { state, page } = yield* T.ask<App>()
    const earlier = undoableHeld(state.held.get())
    const waiting: HeldDecision = { ...decision, phase: 'waiting' }
    state.held.update((all) => [
      ...all.filter((one) => one.phase !== 'done' && one.noteId !== decision.noteId),
      waiting,
    ])
    const me = signedIn(state)
    if (me !== null) keepUnsettled(page.storage, me.member.id, waiting)
    if (earlier !== null && earlier.noteId !== decision.noteId) yield* settle(earlier)
  })

/** Carries out the held decision: its moment is over, the person dismissed it, or the page is closing. */
export const commitHeld: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  const waiting = undoableHeld(state.held.get())
  if (waiting !== null) yield* settle(waiting)
})

/** Forgets the held decision; nothing was asked of the server, so the card is back as it was. */
export const undoHeld: Action = withApp(({ state, page }) =>
  T.sync(() => {
    const waiting = undoableHeld(state.held.get())
    if (waiting === null) return
    state.held.update((all) => all.filter((one) => one !== waiting))
    const me = signedIn(state)
    if (me !== null) forgetUnsettled(page.storage, me.member.id, waiting.noteId)
  }),
)

/** Lets go of the decisions already carried out, once the toast has said so. */
export const forgetSettled: Action = withApp(({ state }) =>
  T.sync(() => state.held.update((all) => all.filter((one) => one.phase !== 'done'))),
)

/**
 * Tells the person of a decision this browser held and never saw carried out, when the draft or answer
 * still waits: the page closed or died first. What is no longer waiting was carried out after all.
 */
export const reportUnsettled: Action = T.gen(function* () {
  const { api, state, page } = yield* T.ask<App>()
  const me = signedIn(state)
  if (me === null) return
  const kept = keptUnsettled(page.storage, me.member.id)
  for (const one of kept) forgetUnsettled(page.storage, me.member.id, one.noteId)
  for (const one of kept) {
    const waits = one.review
      ? state.reviews.get().some((review) => review.note.id === one.noteId)
      : yield* T.fold(
          () => false,
          (note: { readonly status: string }) => note.status === 'draft',
        )(api['notes.get']({ params: { id: one.noteId } }))
    if (waits) return state.notice.set({ kind: 'error', text: one.notDone })
  }
})

/** Keeps the person's edit of a card they have not sent, or forgets it once it is the text again. */
export const keepDraftEdit = (noteId: NoteId, original: string, text: string): Action =>
  withApp(({ state }) =>
    T.sync(() =>
      state.draftEdits.update((all) => {
        const kept = text.trim() === '' || text === original ? undefined : text
        if (all.get(noteId) === kept) return all
        const next = new Map(all)
        if (kept === undefined) next.delete(noteId)
        else next.set(noteId, kept)
        return next
      }),
    ),
  )

/**
 * Asks the server for a held decision; its card stays in place, saying so, until the answer. A refusal
 * brings the card back, and the error is reported as any other.
 */
const settle = (decision: HeldDecision): Action =>
  T.gen(function* () {
    const { state, page } = yield* T.ask<App>()
    const committing: HeldDecision = { ...decision, phase: 'committing' }
    replaceHeld(state, decision, committing)
    let carriedOut = false
    try {
      yield* decision.run
      carriedOut = true
    } finally {
      const me = signedIn(state)
      if (me !== null) forgetUnsettled(page.storage, me.member.id, decision.noteId)
      if (!carriedOut) state.held.update((all) => all.filter((one) => one !== committing))
    }
    replaceHeld(state, committing, { ...committing, phase: 'done' })
    forgetDraftEdit(state, decision.noteId)
  })

const replaceHeld = (state: AppState, from: HeldDecision, to: HeldDecision): void =>
  state.held.update((all) => all.map((one) => (one === from ? to : one)))

const forgetDraftEdit = (state: AppState, noteId: NoteId): void =>
  state.draftEdits.update((all) => {
    if (!all.has(noteId)) return all
    const next = new Map(all)
    next.delete(noteId)
    return next
  })

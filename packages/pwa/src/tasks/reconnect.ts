import { Task as T } from '@homingbird/kernel'
import type { ConversationId } from '@homingbird/protocol'
import type { Action, App } from '../app.ts'
import type { AppState } from '../state.ts'
import { loadPreviews } from './previews.ts'
import { requireSamePerson } from './same-person.ts'

/**
 * Makes up for the events that are never sent again. A draft may be discarded while its event cannot
 * arrive, so the previews are hidden from the moment the events are known to be lost until the server
 * answers again, and stay hidden when it does not. A poll never brings those events, so each poll that
 * answers reads the previews again. One that cannot be read is hidden whatever the failure: unlike a reload
 * an event asked for, nothing says that the preview this page holds is still the draft.
 */
export const catchUp = (app: App): CatchUp => {
  let connected: Transport | null = null
  let hasMissedSome = false
  let stopReading = (): void => {}
  const read = (reading: Action): void => {
    stopReading()
    const running = T.runFork(T.result(reading), app, app.ended)
    stopReading = () => void running.interrupt()
  }
  const lost = (): void => {
    stopReading()
    connected = null
    hasMissedSome = true
    hidePreviews(app.state, [...app.state.previews.get().keys()])
  }
  return {
    lost,
    asking: (transport) => {
      if (connected !== null && !isNextPoll(connected, transport)) lost()
    },
    answered: (transport) => {
      if (isNextPoll(connected, transport)) read(readPreviews)
      else if (hasMissedSome) read(T.flatMap(() => readPreviews)(requireSamePerson))
      connected = transport
    },
  }
}

export interface CatchUp {
  /** A request for events starts. A stream asked for again means that the one before it ended. */
  readonly asking: (transport: Transport) => void
  /** A request for events was answered, so they arrive again. */
  readonly answered: (transport: Transport) => void
  /** Events cannot arrive. */
  readonly lost: () => void
}

export type Transport = 'stream' | 'poll'

const isNextPoll = (connected: Transport | null, transport: Transport): boolean =>
  connected === 'poll' && transport === 'poll'

const readPreviews: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  for (const id of state.previews.get().keys())
    if ((yield* T.result(loadPreviews(id)))._tag === 'Err') hidePreviews(state, [id])
})

/** Shows none of the conversations' previews, and forgets the words they showed. */
const hidePreviews = (state: AppState, ids: ReadonlyArray<ConversationId>): void => {
  const held = state.previews.get()
  const hidden = new Set(ids.flatMap((id) => (held.get(id) ?? []).map((preview) => preview.noteId)))
  if (hidden.size === 0) return
  state.previewedBodies.update((seen) => new Map([...seen].filter(([noteId]) => !hidden.has(noteId))))
  state.previews.update((all) => new Map([...all, ...ids.map((id) => [id, []] as const)]))
}

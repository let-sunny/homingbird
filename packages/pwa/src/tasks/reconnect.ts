import { Schedule, Task as T } from '@homingbird/kernel'
import type { Action, App } from '../app.ts'
import { QUIET_RETRY_SECONDS } from '../load-timing.ts'
import { isTransient } from '../refusals.ts'
import { hidePreviews, loadPreviews } from './previews.ts'
import { type ResourceKey, again } from './resources.ts'
import { requireSamePerson } from './same-person.ts'

/**
 * Makes up for the events that are never sent again. A draft may be discarded while its event cannot
 * arrive, so the previews are hidden from the moment the events are known to be lost until the server
 * answers again, and stay hidden when it does not. A poll never brings those events, so each poll that
 * answers reads the previews again, as does the first connect. One that cannot be read is hidden whatever
 * the failure: unlike a reload an event asked for, nothing says that the preview this page holds is still
 * the draft. The lists that such events bring up to date are asked for afresh too, once, and like the
 * previews only when the server said that the same person is still signed in.
 */
export const catchUp = (app: App): CatchUp => {
  let connected: Transport | null = null
  let owesCatchUp = false
  let stopReading = (): void => {}
  const read = (reading: Action): void => {
    stopReading()
    const running = T.runFork(T.result(reading), app, app.ended)
    stopReading = () => void running.interrupt()
  }
  const readMissedLists: Action = T.gen(function* () {
    yield* T.retry({ schedule: untilAnswered, while: isTransient })(requireSamePerson)
    owesCatchUp = false
    yield* again(...FED_BY_EVENTS_SENT_ONCE)
  })
  const hideAll = (): void => hidePreviews(app.state, [...app.state.previews.get().keys()])
  const lost = (): void => {
    stopReading()
    connected = null
    owesCatchUp = true
    hideAll()
  }
  return {
    lost,
    asking: (transport) => {
      if (connected !== null && !isNextPoll(connected, transport)) lost()
    },
    answered: (transport) => {
      if (!owesCatchUp) read(readPreviews)
      else {
        hideAll()
        read(T.flatMap(() => readPreviews)(readMissedLists))
      }
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

/** The lists that only events never sent again bring up to date. */
const FED_BY_EVENTS_SENT_ONCE: ReadonlyArray<ResourceKey> = ['reviews', 'suggestions', 'debates']

const untilAnswered = (): Iterable<number> => Schedule.exponential(1000, 2, QUIET_RETRY_SECONDS * 1000)

const readPreviews: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  for (const id of state.previews.get().keys())
    if ((yield* T.result(loadPreviews(id)))._tag === 'Err') hidePreviews(state, [id])
})

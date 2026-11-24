import { Schedule, Task as T } from '@homingbird/kernel'
import { type Action, type App, withApp } from '../app.ts'
import { QUIET_RETRY_SECONDS } from '../load-timing.ts'
import { isTransient } from '../refusals.ts'
import { loadDebate } from './debates.ts'
import { loadGroups } from './groups.ts'
import { hidePreviews, loadPreviews } from './previews.ts'
import { again, invalidate } from './resources.ts'
import { requireSamePerson } from './same-person.ts'
import { refreshInterview } from './teaching-interview.ts'

/**
 * Makes up for the events that are never sent again. A draft may be discarded while its event cannot
 * arrive, so the previews are hidden from the moment the events are known to be lost until the server
 * answers again, and stay hidden when it does not. A poll never brings those events, so each poll that
 * answers reads the previews again, as does the first connect. One that cannot be read is hidden whatever
 * the failure: unlike a reload an event asked for, nothing says that the preview this page holds is still
 * the draft. The lists that such events bring up to date are asked for afresh too, once, and like the
 * previews only when the server said that the same person is still signed in. They are also asked for once
 * more when the first stream opened only after them.
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
    yield* askMissed
    yield* rereadShown
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
      const isLate = app.state.stream.get() === 'late'
      if (isLate) app.state.stream.set('settled')
      if (isLate && !owesCatchUp) app.launch(invalidate(...ACTIVITY_LISTS, ...WORKSPACE_LISTS))
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

/** The lists that only events never sent again bring up to date: those of the activity, and of the workspace. */
const ACTIVITY_LISTS = ['reviews', 'suggestions', 'debates'] as const
const WORKSPACE_LISTS = ['conversations', 'directory', 'channels', 'agentCredentials'] as const

/** One that was never read keeps the request on its way, so that a stream that comes and goes never holds it back. */
const askMissed: Action = withApp(({ state }) => {
  const isRead = (key: (typeof WORKSPACE_LISTS)[number]): boolean => state[key].load.get().loaded
  return T.asUnit(
    T.all([
      again(...ACTIVITY_LISTS, ...WORKSPACE_LISTS.filter(isRead)),
      invalidate(...WORKSPACE_LISTS.filter((key) => !isRead(key))),
    ]),
  )
})

/** The rest that such events bring up to date, where this page holds it. */
const rereadShown: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  const shown = state.route.get()
  if (state.groupsLoaded.get()) yield* T.result(loadGroups)
  if (state.interview.get() !== null) yield* refreshInterview
  if (shown.name === 'debate') yield* T.result(loadDebate(shown.id))
})

const untilAnswered = (): Iterable<number> => Schedule.exponential(1000, 2, QUIET_RETRY_SECONDS * 1000)

const readPreviews: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  for (const id of state.previews.get().keys())
    if ((yield* T.result(loadPreviews(id)))._tag === 'Err') hidePreviews(state, [id])
})

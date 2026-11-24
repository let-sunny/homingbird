import { Task as T } from '@homingbird/kernel'
import type {
  ApiError,
  AsRead,
  ConversationId,
  CredentialId,
  DebateExportFormat,
  DebateId,
  DebateLimitsWish,
  DebateVisibility,
  Locale,
  MemberId,
  ScheduleSetup,
} from '@homingbird/protocol'
import { track } from '../analytics.ts'
import { type Action, withApp } from '../app.ts'
import type { AppState } from '../state.ts'
import { again, invalidate, open } from './resources.ts'

/** The flocks list as its page opens, and as the person asks to try again. */
export const openDebateList: Action = open('debates')

export const askDebateListAgain: Action = again('debates')

/**
 * Reads the flock shown on screen again; a flock the person may not see is shown as missing. An answer
 * for a flock that is no longer the one at the address is dropped, and so is one asked for before the
 * newest answer shown.
 */
export const loadDebate = (id: string): Action =>
  withApp(({ api, state }) =>
    T.suspend(() => {
      const show = showInOrder(state)
      return T.catchTag('NotFound', () => T.sync(() => void show(id, 'missing')))(
        T.map((debate: AsRead.Debate) => void show(id, debate))(api['debates.get']({ params: { id } })),
      )
    }),
  )

export interface DebateWish {
  readonly question: string
  readonly visibility: DebateVisibility
  readonly limits: DebateLimitsWish
  readonly memberIds: ReadonlyArray<MemberId>
}

export const createDebate = (wish: DebateWish): Action<AsRead.Debate> =>
  withApp(({ api }) =>
    T.tap((_: AsRead.Debate) =>
      T.flatMap(() => invalidate('debates'))(track('debate_opened', { visibility: wish.visibility })),
    )(api['debates.create']({ body: wish })),
  )

/** Opens a scheduling flock for the setup the person typed; the list is read again so the flock shows in it. */
export const createSchedulingRoom = (setup: ScheduleSetup): Action<AsRead.Debate> =>
  withApp(({ api }) =>
    T.tap((_: AsRead.Debate) => invalidate('debates'))(api['scheduling.create']({ body: setup })),
  )

/** Gives the free times the person picked themself, none at all when they are busy throughout. */
export const setMyFreeTimes = (
  id: DebateId,
  slots: ReadonlyArray<{ readonly startsAt: number; readonly endsAt: number }>,
): Action =>
  withApp(({ api, state }) =>
    shown(state, api['scheduling.slots.set']({ params: { id }, body: { slots: [...slots] } })),
  )

/** The person's click to have the meeting added to their calendar, or to say they added it themself. */
export const addMeeting = (id: DebateId): Action =>
  withApp(({ api, state }) => shown(state, api['scheduling.attendance.add']({ params: { id } })))

/** Takes the meeting out of the person's calendar; for whoever opened the flock, cancels it for everyone. */
export const removeMeeting = (id: DebateId): Action =>
  withApp(({ api, state }) => shown(state, api['scheduling.attendance.remove']({ params: { id } })))

/** Opts the person's agent in, with their note on what it may use here when they wrote one. */
export const optInAgent = (id: DebateId, agentId: CredentialId, brief: string): Action =>
  withApp(({ api, state }) =>
    shown(
      state,
      api['debates.optIn']({
        params: { id },
        body: { agentId, ...(brief.trim() !== '' && { brief: brief.trim() }) },
      }),
    ),
  )

/** Sets or clears the person's note on what their agent may use and share in the flock. */
export const setBrief = (id: DebateId, brief: string): Action =>
  withApp(({ api, state }) =>
    shown(state, api['debates.brief.set']({ params: { id }, body: { brief: brief.trim() } })),
  )

export const changeLimits = (id: DebateId, limits: DebateLimitsWish): Action =>
  withApp(({ api, state }) => shown(state, api['debates.limits.set']({ params: { id }, body: limits })))

export type ResultDestination =
  | { readonly channel: string }
  | { readonly to: MemberId }
  | { readonly conversationId: ConversationId }

export const postResult = (id: DebateId, destination: ResultDestination): Action<AsRead.Note> =>
  withApp(({ api }) => api['debates.result.post']({ params: { id }, body: destination }))

/** The export's headings come in the language the person reads the web client in. */
export const exportDebate = (
  id: DebateId,
  format: DebateExportFormat,
  language: Locale,
): Action<AsRead.DebateExport> =>
  withApp(({ api }) => api['debates.export']({ params: { id }, body: { format, language } }))

/** Shows the answer to a change; when something asked for later is shown already, the flock is read again. */
const shown = (state: AppState, change: T.Task<AsRead.Debate, ApiError>): Action =>
  T.suspend(() => {
    const show = showInOrder(state)
    return T.flatMap(
      (debate: AsRead.Debate): Action =>
        show(debate.id, debate) ? T.unit : T.asUnit(T.result(loadDebate(debate.id))),
    )(change)
  })

/** Shows an answer unless the person left for another address; false when a newer answer is shown. */
const showInOrder = (state: AppState): ((id: string, shownNow: AsRead.Debate | 'missing') => boolean) => {
  const asked = state.debateAnswers.get().asked + 1
  state.debateAnswers.update((answers) => ({ ...answers, asked }))
  return (id, shownNow) => {
    const at = state.route.get()
    if (at.name !== 'debate' || at.id !== id) return true
    if (asked < state.debateAnswers.get().shown) return false
    state.debateAnswers.update((answers) => ({ ...answers, shown: asked }))
    state.shownDebate.set(shownNow)
    return true
  }
}

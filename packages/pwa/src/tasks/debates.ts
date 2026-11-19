import { Task as T } from '@homingbird/kernel'
import type {
  ApiError,
  AsRead,
  ConversationId,
  CredentialId,
  DebateExportFormat,
  DebateId,
  DebateLimits,
  DebateVisibility,
  Locale,
  MemberId,
} from '@homingbird/protocol'
import { track } from '../analytics.ts'
import { type Action, withApp } from '../app.ts'
import type { AppState } from '../state.ts'

export const loadDebates: Action = withApp(({ api, state }) =>
  T.map((listed: { debates: ReadonlyArray<AsRead.DebateSummary> }) => {
    state.debates.set(listed.debates)
    state.debatesLoaded.set(true)
  })(api['debates.list']({})),
)

/** Reads the room shown on screen again; a room the person may not see is shown as missing. */
export const loadDebate = (id: string): Action =>
  withApp(({ api, state }) =>
    T.catchTag('NotFound', () => T.sync(() => state.shownDebate.set('missing')))(
      T.map((debate: AsRead.Debate) => state.shownDebate.set(debate))(api['debates.get']({ params: { id } })),
    ),
  )

export interface DebateWish {
  readonly question: string
  readonly visibility: DebateVisibility
  readonly limits: DebateLimits
  readonly memberIds: ReadonlyArray<MemberId>
}

export const createDebate = (wish: DebateWish): Action<AsRead.Debate> =>
  withApp(({ api }) =>
    T.tap((_: AsRead.Debate) =>
      T.flatMap(() => loadDebates)(track('debate_opened', { visibility: wish.visibility })),
    )(api['debates.create']({ body: wish })),
  )

export const optInAgent = (id: DebateId, agentId: CredentialId): Action =>
  withApp(({ api, state }) => shown(state, api['debates.optIn']({ params: { id }, body: { agentId } })))

export const changeLimits = (id: DebateId, limits: DebateLimits): Action =>
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

const shown = (state: AppState, change: T.Task<AsRead.Debate, ApiError>): Action =>
  T.map((debate: AsRead.Debate) => state.shownDebate.set(debate))(change)

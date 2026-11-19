import { Task as T } from '@homingbird/kernel'
import type {
  ApiError,
  ConversationId,
  CredentialId,
  Debate,
  DebateExport,
  DebateExportFormat,
  DebateId,
  DebateLimits,
  DebateSummary,
  DebateVisibility,
  MemberId,
  Note,
} from '@homingbird/protocol'
import { type Action, api } from './actions.ts'
import { debates, debatesLoaded, shownDebate } from './state.ts'

/** Built when run, because this module and `actions.ts` import each other through `live.ts`. */
export const loadDebates: Action = T.suspend(() =>
  T.map((listed: { debates: ReadonlyArray<DebateSummary> }) => {
    debates.set(listed.debates)
    debatesLoaded.set(true)
  })(api['debates.list']({})),
)

/** Reads the room shown on screen again; a room the person may not see is shown as missing. */
export const loadDebate = (id: string): Action =>
  T.catchTag('NotFound', () => T.sync(() => shownDebate.set('missing')))(
    T.map((debate: Debate) => shownDebate.set(debate))(api['debates.get']({ params: { id } })),
  )

export interface DebateWish {
  readonly question: string
  readonly visibility: DebateVisibility
  readonly limits: DebateLimits
  readonly memberIds: ReadonlyArray<MemberId>
}

export const createDebate = (wish: DebateWish): Action<Debate> =>
  T.tap((_: Debate) => loadDebates)(api['debates.create']({ body: wish }))

export const optInAgent = (id: DebateId, agentId: CredentialId): Action =>
  shown(api['debates.optIn']({ params: { id }, body: { agentId } }))

export const changeLimits = (id: DebateId, limits: DebateLimits): Action =>
  shown(api['debates.limits.set']({ params: { id }, body: limits }))

/**
 * Approves the drafted result the person read. When it changed meanwhile the server refuses, and the
 * room is read again so the person sees the draft they would be deciding on.
 */
export const approveResult = (id: DebateId, draftedAt: number): Action =>
  readAgainOnConflict(id, shown(api['debates.result.approve']({ params: { id }, body: { draftedAt } })))

export const declineResult = (id: DebateId, draftedAt: number): Action =>
  readAgainOnConflict(id, shown(api['debates.result.decline']({ params: { id }, body: { draftedAt } })))

export type ResultDestination =
  | { readonly channel: string }
  | { readonly to: MemberId }
  | { readonly conversationId: ConversationId }

export const postResult = (id: DebateId, destination: ResultDestination): Action<Note> =>
  api['debates.result.post']({ params: { id }, body: destination })

export const exportDebate = (id: DebateId, format: DebateExportFormat): Action<DebateExport> =>
  api['debates.export']({ params: { id }, body: { format } })

const readAgainOnConflict = (id: DebateId, decision: Action): Action =>
  T.tapError((error: ApiError) => (error._tag === 'Conflict' ? loadDebate(id) : T.unit))(decision)

const shown = (change: Action<Debate>): Action => T.map((debate: Debate) => shownDebate.set(debate))(change)

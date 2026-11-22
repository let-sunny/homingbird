import { Task as T } from '@homingbird/kernel'
import type { AsRead, AutoSend, NoteId, PrincipleKind } from '@homingbird/protocol'
import { track } from '../analytics.ts'
import { type Action, withApp } from '../app.ts'

/** The person's own agent figures; a failure leaves the list as it is and says so on the card. */
export const refreshAgentReport: Action = withApp(({ api, state }) =>
  T.fold(
    () => state.agentReport.set('failed'),
    (report: AsRead.AgentReport) => state.agentReport.set(report),
  )(api['insights.mine']({})),
)

/** What the person taught their agent: principles, chances to teach, the route map. */
export const refreshPrinciples: Action = withApp(({ api, state }) =>
  T.fold(
    () => state.taught.set('failed'),
    (loaded: AsRead.MyPrinciples) => state.taught.set(loaded),
  )(api['principles.list']({})),
)

export interface PrincipleInput {
  readonly kind?: PrincipleKind
  readonly publicText?: string | null
  readonly topic: string
  readonly rule: string
  readonly source: string | null
  readonly place: string | null
  readonly offerId?: string
  readonly confirmed?: boolean
}

export interface PrincipleChange {
  readonly kind?: PrincipleKind
  readonly topic?: string
  readonly rule?: string
  readonly source?: string | null
  readonly enabled?: boolean
  readonly publicText?: string | null
}

export const savePrinciple = (input: PrincipleInput): Action =>
  withApp(({ api }) =>
    T.flatMap(() =>
      T.flatMap(() => refreshPrinciples)(track('principle_saved', { kind: input.kind ?? 'rule' })),
    )(api['principles.create']({ body: input })),
  )

export const changePrinciple = (id: string, change: PrincipleChange): Action =>
  withApp(({ api }) =>
    T.flatMap(() => refreshPrinciples)(api['principles.update']({ params: { id }, body: change })),
  )

/** Switches one saved answer's automatic sending, with the places it may send itself, as its person chose. */
export const setAutoSend = (id: string, setting: AutoSend): Action =>
  withApp(({ api }) =>
    T.flatMap(() => refreshPrinciples)(api['principles.autoSend.set']({ params: { id }, body: setting })),
  )

export const reorderPrinciples = (ids: ReadonlyArray<string>): Action =>
  withApp(({ api, state }) =>
    T.map((loaded: AsRead.MyPrinciples) => state.taught.set(loaded))(
      api['principles.reorder']({
        body: { ids: ids as ReadonlyArray<AsRead.MyPrinciples['principles'][number]['id']> },
      }),
    ),
  )

export const deletePrinciple = (id: string): Action =>
  withApp(({ api }) => T.flatMap(() => refreshPrinciples)(api['principles.delete']({ params: { id } })))

export const markPrincipleWrong = (id: string, noteId: NoteId): Action =>
  withApp(({ api }) =>
    T.flatMap(() => refreshPrinciples)(api['principles.miss']({ params: { id }, body: { noteId } })),
  )

export const dismissOffer = (id: string, stopAskingHere: boolean): Action =>
  withApp(({ api }) =>
    T.flatMap(() => refreshPrinciples)(
      api['principles.offers.dismiss']({ params: { id }, body: stopAskingHere ? { stopAskingHere } : {} }),
    ),
  )

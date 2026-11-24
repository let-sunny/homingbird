import { Task as T } from '@homingbird/kernel'
import type { AsRead, AutoSend, NoteId, PrincipleKind } from '@homingbird/protocol'
import { track } from '../analytics.ts'
import { type Action, withApp } from '../app.ts'
import { inOrder } from '../principles.ts'
import { reread } from './resources.ts'

/** The person's own agent figures, asked for again; the card shows what it had until the answer comes. */
export const refreshAgentReport: Action = reread('agentReport')

/** What the person taught their agent, asked for again: principles, chances to teach, each place's progress. */
export const refreshPrinciples: Action = reread('taught')

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
    T.map(() => state.taught.update((taught) => taught && inOrder(taught, ids)))(
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

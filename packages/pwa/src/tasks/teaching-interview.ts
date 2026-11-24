import { Task as T } from '@homingbird/kernel'
import type { ApiError, AsRead, PrincipleKind, ProposalId } from '@homingbird/protocol'
import { isSameData } from '@homingbird/ui'
import { type Action, withApp } from '../app.ts'
import { isTransient, refusalOfServer } from '../refusals.ts'
import { refreshPrinciples } from './teaching.ts'

/**
 * The pasted document and the proposals waiting; a failure says so in the section, unless it shows what it
 * has and the server is only away. The same data again draws nothing, so what the person types there stays.
 */
export const refreshInterview: Action = withApp(({ api, state }) =>
  T.fold(
    (error: ApiError) => {
      const isShown = state.interview.get() !== null && state.interview.get() !== 'failed'
      if (!isShown || !isTransient(refusalOfServer(error))) state.interview.set('failed')
    },
    (loaded: AsRead.TeachingInterview) => {
      if (!isSameData(loaded, state.interview.get())) state.interview.set(loaded)
    },
  )(api['principleProposals.list']({})),
)

export const saveTeachingDocument = (document: string | null): Action =>
  withApp(({ api }) =>
    T.flatMap(() => refreshInterview)(api['teaching.document.set']({ body: { document } })),
  )

export interface ProposalChange {
  readonly kind?: PrincipleKind
  readonly topic?: string
  readonly rule?: string
}

export const acceptProposal = (id: ProposalId, change: ProposalChange): Action =>
  withApp(({ api }) =>
    T.flatMap(() => T.flatMap(() => refreshPrinciples)(refreshInterview))(
      api['principleProposals.accept']({ params: { id }, body: change }),
    ),
  )

export const acceptProposals = (ids: ReadonlyArray<ProposalId>): Action =>
  withApp(({ api, state }) =>
    T.flatMap((loaded: AsRead.MyPrinciples) => {
      state.taught.set(loaded)
      return refreshInterview
    })(api['principleProposals.acceptAll']({ body: { ids } })),
  )

export const discardProposal = (id: ProposalId): Action =>
  withApp(({ api }) =>
    T.flatMap(() => refreshInterview)(api['principleProposals.discard']({ params: { id } })),
  )

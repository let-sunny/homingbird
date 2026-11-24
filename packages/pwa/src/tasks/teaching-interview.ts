import { Task as T } from '@homingbird/kernel'
import type { PrincipleKind, ProposalId } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'
import { reread } from './resources.ts'
import { refreshPrinciples } from './teaching.ts'

/** The pasted document and the proposals waiting, asked for again after what changed them. */
export const refreshInterview: Action = reread('interview')

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
  withApp(({ api }) =>
    T.flatMap(() => reread('interview', 'taught'))(api['principleProposals.acceptAll']({ body: { ids } })),
  )

export const discardProposal = (id: ProposalId): Action =>
  withApp(({ api }) =>
    T.flatMap(() => refreshInterview)(api['principleProposals.discard']({ params: { id } })),
  )

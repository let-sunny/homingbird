import type { DebateResult } from './debate-result.ts'
import type { Debate } from './debates.ts'
import type { MemberId, Timestamp } from './ids.ts'

export interface DraftedDebateResult {
  readonly result: DebateResult
  readonly draftedBy: MemberId
  readonly draftedAt: Timestamp
}

/** A debate's result as its agents drafted it; null for no result, a computed one or a kind this client does not know. */
export const draftedResultOf = (settled: Debate['result']): DraftedDebateResult | null => {
  if (settled === null || settled.draftedBy === null) return null
  const { result, draftedBy, draftedAt } = settled
  return isDebateResult(result) ? { result, draftedBy, draftedAt } : null
}

/** Whether a room result is one a debate settles on, as opposed to a time, or a kind this client does not know. */
export const isDebateResult = <R extends { readonly kind: string }>(
  result: R,
): result is Extract<R, { readonly kind: 'conclusion' | 'no_conclusion' }> =>
  result.kind === 'conclusion' || result.kind === 'no_conclusion'

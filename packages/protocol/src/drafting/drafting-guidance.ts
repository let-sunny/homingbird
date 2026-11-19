import type { Result } from '@homingbird/kernel'
import { answeringFlowFrom } from '../answering-flow.ts'
import type * as AsRead from '../as-read.ts'
import { ANSWERING_FLOW_UNAVAILABLE, answeringFlowInstructions } from './answering-flow-instructions.ts'
import { PRINCIPLES_UNAVAILABLE, principlesInstructions } from './principle-selection.ts'

/** What a drafting prompt adds for one conversation: the answering flow, then the person's principles. */
export const draftingGuidance = (flow: string, principles: string): string =>
  [flow, principles].filter((part) => part !== '').join('\n\n')

/** The answering flow as a desk fetched it: nothing when the feature is off, a notice when it failed. */
export const flowGuidance = (fetched: Result.Result<{ readonly flow: string | null }, Tagged>): string => {
  if (fetched._tag === 'Err') return isTurnedOff(fetched.error) ? '' : ANSWERING_FLOW_UNAVAILABLE
  if (fetched.value.flow === null) return ''
  const flow = answeringFlowFrom(fetched.value.flow)
  return flow._tag === 'Ok' ? answeringFlowInstructions(flow.value) : ANSWERING_FLOW_UNAVAILABLE
}

/** The principles the server selected for a conversation, channel principles first, as a desk fetched them. */
export const principlesGuidance = (fetched: Result.Result<AsRead.DraftingPrinciples, Tagged>): string => {
  if (fetched._tag === 'Ok') return principlesInstructions(fetched.value)
  return isTurnedOff(fetched.error) ? '' : PRINCIPLES_UNAVAILABLE
}

interface Tagged {
  readonly _tag: string
}

/** A feature the organization turned off answers NotFound; the agent is then told nothing about it. */
const isTurnedOff = (error: Tagged): boolean => error._tag === 'NotFound'

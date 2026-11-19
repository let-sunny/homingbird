import { type HasClock, Task as T } from '@homingbird/kernel'
import {
  ANSWERING_FLOW_UNAVAILABLE,
  type Api,
  type ConversationId,
  type DraftingPrinciples,
  PRINCIPLES_UNAVAILABLE,
  answeringFlowFrom,
  answeringFlowInstructions,
  draftingGuidance,
  principlesInstructions,
} from '@homingbird/protocol'

/**
 * The guidance for one draft: the administrator's answering flow, then the person's principles,
 * fetched again for every draft so a desk always follows the current set.
 */
export const answeringFlowFor = (
  api: Api,
  conversationId?: ConversationId,
): T.Task<string, never, HasClock> =>
  T.map(([flow, principles]: readonly [string, string]) => draftingGuidance(flow, principles))(
    T.all([flowFor(api), principlesFor(api, conversationId)] as const),
  )

const flowFor = (api: Api): T.Task<string, never, HasClock> =>
  T.map((fetched: { _tag: 'Ok'; value: { flow: string | null } } | { _tag: 'Err'; error: unknown }) => {
    if (fetched._tag === 'Err') return isTurnedOff(fetched.error) ? '' : ANSWERING_FLOW_UNAVAILABLE
    if (fetched.value.flow === null) return ''
    const flow = answeringFlowFrom(fetched.value.flow)
    return flow._tag === 'Ok' ? answeringFlowInstructions(flow.value) : ANSWERING_FLOW_UNAVAILABLE
  })(T.result(T.timeout(FLOW_TIMEOUT_MS)(api['answeringFlow.get']({}))))

const principlesFor = (
  api: Api,
  conversationId: ConversationId | undefined,
): T.Task<string, never, HasClock> =>
  T.map((fetched: { _tag: 'Ok'; value: DraftingPrinciples } | { _tag: 'Err'; error: unknown }) =>
    fetched._tag === 'Ok'
      ? principlesInstructions(fetched.value)
      : isTurnedOff(fetched.error)
        ? ''
        : PRINCIPLES_UNAVAILABLE,
  )(
    T.result(
      T.timeout(FLOW_TIMEOUT_MS)(
        api['principles.drafting']({ query: conversationId === undefined ? {} : { conversationId } }),
      ),
    ),
  )

/** A feature the organization turned off answers NotFound; the agent is then told nothing about it. */
const isTurnedOff = (error: unknown): boolean => (error as { _tag?: unknown } | null)?._tag === 'NotFound'

const FLOW_TIMEOUT_MS = 5_000

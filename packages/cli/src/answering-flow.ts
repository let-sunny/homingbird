import { type HasClock, Task as T } from '@homingbird/kernel'
import {
  type Api,
  type ConversationId,
  draftingGuidance,
  flowGuidance,
  principlesGuidance,
} from '@homingbird/protocol'

/**
 * The guidance for one draft: the administrator's answering flow, then the person's principles,
 * fetched again for every draft so a desk always follows the current set.
 */
export const answeringFlowFor = (
  api: Pick<Api, 'answeringFlow.get' | 'principles.drafting'>,
  conversationId?: ConversationId,
): T.Task<string, never, HasClock> =>
  T.gen(function* () {
    const [flow, principles] = yield* T.all([
      T.result(T.timeout(FLOW_TIMEOUT_MS)(api['answeringFlow.get']({}))),
      T.result(
        T.timeout(FLOW_TIMEOUT_MS)(
          api['principles.drafting']({ query: conversationId === undefined ? {} : { conversationId } }),
        ),
      ),
    ] as const)
    return draftingGuidance(flowGuidance(flow), principlesGuidance(principles))
  })

const FLOW_TIMEOUT_MS = 5_000

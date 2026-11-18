import { type HasClock, Task as T } from '@homingbird/kernel'
import {
  ANSWERING_FLOW_UNAVAILABLE,
  type Api,
  answeringFlowFrom,
  answeringFlowInstructions,
} from '@homingbird/protocol'

export const answeringFlowFor = (api: Api): T.Task<string, never, HasClock> =>
  T.map((fetched: { _tag: 'Ok'; value: { flow: string | null } } | { _tag: 'Err' }) => {
    if (fetched._tag === 'Err') return ANSWERING_FLOW_UNAVAILABLE
    if (fetched.value.flow === null) return ''
    const flow = answeringFlowFrom(fetched.value.flow)
    return flow._tag === 'Ok' ? answeringFlowInstructions(flow.value) : ANSWERING_FLOW_UNAVAILABLE
  })(T.result(T.timeout(FLOW_TIMEOUT_MS)(api['answeringFlow.get']({}))))

const FLOW_TIMEOUT_MS = 5_000

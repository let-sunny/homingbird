import { Task as T } from '@homingbird/kernel'
import type { AsRead, DebateId, SchedulingDelegation, SchedulingDelegationView } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'
import { invalidate } from './resources.ts'

export const loadSchedulingDelegation: Action<SchedulingDelegationView> = withApp(({ api }) =>
  api['me.scheduling.get']({}),
)

export const saveSchedulingDelegation = (
  delegation: SchedulingDelegation,
): Action<SchedulingDelegationView> => withApp(({ api }) => api['me.scheduling.set']({ body: delegation }))

/** Opens a new flock with the same people and length, in the window given or the same one; the list is read again. */
export const retrySchedulingRoom = (
  id: DebateId,
  window: { readonly startsAt: number; readonly endsAt: number } | null,
): Action<AsRead.Debate> =>
  withApp(({ api }) =>
    T.tap((_: AsRead.Debate) => invalidate('debates'))(
      api['scheduling.retry']({ params: { id }, body: window === null ? {} : { window } }),
    ),
  )

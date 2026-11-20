import { Task as T } from '@homingbird/kernel'
import type { AsRead, DeskWakeSetup } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'

export const loadDeskWake: Action<AsRead.DeskWake | null> = withApp(({ api }) =>
  T.map((read: { readonly wake: AsRead.DeskWake | null }) => read.wake)(api['me.deskWake.get']({})),
)

export const saveDeskWake = (setup: DeskWakeSetup): Action<AsRead.DeskWake> =>
  withApp(({ api }) => api['me.deskWake.set']({ body: setup }))

export const removeDeskWake: Action = withApp(({ api }) => T.asUnit(api['me.deskWake.remove']({})))

export const testDeskWake: Action<AsRead.DeskWakeTest> = withApp(({ api }) =>
  api['me.deskWake.test']({ body: {} }),
)

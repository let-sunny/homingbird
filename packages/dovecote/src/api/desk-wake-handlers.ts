import { Task as T } from '@homingbird/kernel'
import type { DeskWake } from '@homingbird/protocol'
import type { RequestEnv } from '../events/events.ts'
import { deskWakeOf, registerDeskWake, removeDeskWake } from '../wake/desk-wakes.ts'
import type { Handlers } from './handlers.ts'

/** A person's cloud desk wake: set up, read back without its secrets, tested and removed, by them only. */
export const deskWakeHandlers = {
  'me.deskWake.get': (_, caller) =>
    T.map((wake: DeskWake | null) => ({ wake }))(deskWakeOf(caller.member.id)),
  'me.deskWake.set': ({ body }, caller) => registerDeskWake(caller, body),
  'me.deskWake.remove': (_, caller) => T.as({})(removeDeskWake(caller.member.id)),
  'me.deskWake.test': (_, caller) =>
    T.gen(function* () {
      const env = yield* T.ask<RequestEnv>()
      return yield* env.wakeTest(caller.member.id)
    }),
} satisfies Partial<Handlers>

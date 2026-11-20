import type { Task as T } from '@homingbird/kernel'
import type { ApiError, Contract, RequestOf, ResponseOf, RouteName } from '@homingbird/protocol'
import type { Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { accountHandlers } from './account-handlers.ts'
import { adminHandlers } from './admin-handlers.ts'
import { channelHandlers } from './channel-handlers.ts'
import { contactHandlers } from './contact-handlers.ts'
import { credentialHandlers } from './credential-handlers.ts'
import { debateHandlers } from './debate-handlers.ts'
import { deskWakeHandlers } from './desk-wake-handlers.ts'
import { eventHandlers } from './event-handlers.ts'
import { groupHandlers } from './group-handlers.ts'
import { noteHandlers } from './note-handlers.ts'
import { teachingHandlers } from './teaching-handlers.ts'

/** One handler for every route of the contract; the type fails when a route has none. */
export const handlers: Handlers = {
  ...accountHandlers,
  ...deskWakeHandlers,
  ...channelHandlers,
  ...groupHandlers,
  ...contactHandlers,
  ...noteHandlers,
  ...teachingHandlers,
  ...debateHandlers,
  ...credentialHandlers,
  ...eventHandlers,
  ...adminHandlers,
}

export type Handlers = {
  readonly [N in RouteName]: (
    request: RequestOf<Contract[N]>,
    caller: CallerOf<N>,
  ) => T.Task<ResponseOf<Contract[N]>, ApiError, RequestEnv>
}

export type CallerOf<N extends RouteName> = Contract[N]['access'] extends 'public' ? null : Caller

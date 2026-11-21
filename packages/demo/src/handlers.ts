import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type Contract,
  Forbidden,
  NotFound,
  type RequestOf,
  type ResponseOf,
  type RouteName,
} from '@homingbird/protocol'
import type { MemberId } from '@homingbird/protocol'
import { accountHandlers } from './account-handlers.ts'
import { adminHandlers } from './admin-handlers.ts'
import { channelHandlers } from './channel-handlers.ts'
import { debateHandlers } from './debate-handlers.ts'
import { inviteHandlers } from './invite-handlers.ts'
import { noteHandlers } from './note-handlers.ts'
import { previewHandlers } from './preview-handlers.ts'
import type { World } from './world.ts'

/** The routes the demo answers; any other refuses with `DEMO_REFUSAL`. */
export const handlersOf = (world: World): Handlers => ({
  ...accountHandlers(world),
  ...adminHandlers(world),
  ...channelHandlers(world),
  ...debateHandlers(world),
  ...inviteHandlers(world),
  ...noteHandlers(world),
  ...previewHandlers(world),
})

export type Handlers = { readonly [N in RouteName]?: Handler<N> }

export type Handler<N extends RouteName> = (
  request: RequestOf<Contract[N]>,
  viewerId: MemberId,
) => T.Task<ResponseOf<Contract[N]>, ApiError>

/** What the demo answers for something only a real Dovecote does. */
export const DEMO_REFUSAL = Forbidden({
  message: 'The demo does not do this. Run your own Homingbird server to try it with your team.',
})

/** A value a handler found, or a 404 that says what was missing. */
export const found = <A>(value: A | null | undefined, missing: string): T.Task<A, NotFound> =>
  value === null || value === undefined ? T.fail(NotFound({ message: missing })) : T.succeed(value)

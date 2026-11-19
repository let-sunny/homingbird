import { Task as T } from '@homingbird/kernel'
import { type Api, type ApiError, UPGRADE_SENTENCES, Unavailable, upgradeNeeded } from '@homingbird/protocol'

/**
 * The check a client makes once when a session, stream or desk starts: a server of a protocol it cannot
 * read fails with one sentence naming the side to upgrade.
 */
export const requireReadableServer = (api: Pick<Api, 'server.info'>): T.Task<void, ApiError> =>
  T.flatMap((info: { readonly protocolVersion: number }) => {
    const side = upgradeNeeded(info)
    return side === null ? T.unit : T.fail(Unavailable({ message: UPGRADE_SENTENCES[side] }))
  })(T.suspend(() => api['server.info']({})))

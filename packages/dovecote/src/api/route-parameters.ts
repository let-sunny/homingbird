import { Task as T } from '@homingbird/kernel'
import { Invalid } from '@homingbird/protocol'

/** A path parameter decoded as the identifier its route names, or a 400 the caller can read. */
export const identifier = <Id>(
  schema: {
    readonly decode: (
      input: unknown,
    ) => { readonly _tag: 'Ok'; readonly value: Id } | { readonly _tag: 'Err' }
  },
  raw: string,
): T.Task<Id, Invalid> => {
  const decoded = schema.decode(raw)
  return decoded._tag === 'Ok'
    ? T.succeed(decoded.value)
    : T.fail(Invalid({ message: 'That identifier is not valid.' }))
}

export const pageSize = (limit: string | undefined): number =>
  Math.max(1, Math.min(MAX_PAGE_SIZE, limit === undefined ? DEFAULT_PAGE_SIZE : Number(limit)))

export const channelPageSize = (limit: string | undefined): number =>
  Math.max(1, Math.min(MAX_CHANNEL_PAGE, Number(limit ?? DEFAULT_CHANNEL_PAGE)))

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200
const DEFAULT_CHANNEL_PAGE = 50
const MAX_CHANNEL_PAGE = 200

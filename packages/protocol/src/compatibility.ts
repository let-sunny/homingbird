/** Raised only by a breaking protocol change. A server that sends no protocol version speaks 1. */
export const PROTOCOL_VERSION = 1

export const READABLE_PROTOCOLS = { oldest: 1, newest: PROTOCOL_VERSION } as const

export const UNKNOWN = 'unknown'

export const isKnown = <T>(value: T): value is Exclude<T, typeof UNKNOWN> => value !== UNKNOWN

export const upgradeNeeded = (info: { readonly protocolVersion: number }): 'client' | 'server' | null =>
  info.protocolVersion > READABLE_PROTOCOLS.newest
    ? 'client'
    : info.protocolVersion < READABLE_PROTOCOLS.oldest
      ? 'server'
      : null

export const UPGRADE_SENTENCES = {
  client: 'This Homingbird server is newer than this client understands; upgrade the client.',
  server: 'This Homingbird server is too old for this client; upgrade the server.',
} as const satisfies Readonly<Record<'client' | 'server', string>>

/** A feature is offered only when the server lists it as on; a server that lists none offers none. */
export const isFeatureOffered = (
  info: { readonly features?: Readonly<Record<string, boolean>> },
  name: string,
): boolean =>
  info.features !== undefined && Object.hasOwn(info.features, name) && info.features[name] === true

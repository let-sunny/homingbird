export const STATELESS_REVISIONS = ['2026-07-28'] as const

export const HANDSHAKE_REVISIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const

export const SUPPORTED_REVISIONS: ReadonlyArray<string> = [...STATELESS_REVISIONS, ...HANDSHAKE_REVISIONS]

export const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion'
export const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo'
export const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo'

export const UNSUPPORTED_PROTOCOL_VERSION_CODE = -32022

export const handshakeRevisionFor = (requested: unknown): string =>
  typeof requested === 'string' && (HANDSHAKE_REVISIONS as ReadonlyArray<string>).includes(requested)
    ? requested
    : HANDSHAKE_REVISIONS[0]

export const claimedRevision = (params: Readonly<Record<string, unknown>>): string | null => {
  const meta = params._meta
  if (typeof meta !== 'object' || meta === null) return null
  const claimed = (meta as Readonly<Record<string, unknown>>)[PROTOCOL_VERSION_META_KEY]
  return claimed === undefined ? null : String(claimed)
}

export const isStateless = (revision: string | null): boolean =>
  revision !== null && (STATELESS_REVISIONS as ReadonlyArray<string>).includes(revision)

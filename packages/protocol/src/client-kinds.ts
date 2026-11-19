import { Schema as S } from '@homingbird/kernel'

/**
 * What kind of program a credential was issued to, as the audit trail records it instead of the name
 * the program gave itself. An older client that says nothing counts as `device`.
 */
export const CLIENT_KIND = S.literal('browser', 'cli', 'mcp', 'plugin', 'oauth', 'device')
export type ClientKind = S.Infer<typeof CLIENT_KIND>

export const DEVICE_CLIENT_KINDS: ReadonlyArray<ClientKind> = ['cli', 'mcp', 'plugin']

export const deviceClientKindOf = (value: string | undefined): ClientKind =>
  DEVICE_CLIENT_KINDS.includes(value as ClientKind) ? (value as ClientKind) : 'device'

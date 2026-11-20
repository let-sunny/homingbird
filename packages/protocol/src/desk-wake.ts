import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { CredentialId, Timestamp } from './ids.ts'

/** A cloud desk's wake, read back without the address's path or any header value. */
export const DeskWake = S.struct({
  host: S.string({ maxLength: 253 }),
  headerNames: S.array(S.string({ maxLength: 64 }), { maxItems: 8 }),
  credentialId: CredentialId,
  enabled: S.boolean,
  lastWakeAt: S.nullable(Timestamp),
  lastStatus: S.tolerant(
    S.literal('never', 'sent', 'online', 'not_online', 'refused', 'rate_limited', 'unreachable'),
    UNKNOWN,
  ),
  failures: S.int({ min: 0 }),
  stoppedBecause: S.nullable(
    S.tolerant(S.literal('refused', 'failures', 'credential_gone', 'unreadable'), UNKNOWN),
  ),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type DeskWake = S.Infer<typeof DeskWake>

export type DeskWakeStatus = DeskWake['lastStatus']

export type DeskWakeStop = NonNullable<DeskWake['stoppedBecause']>

export const DESK_WAKE_HEADERS_MAX = 4

export const DeskWakeHeader = S.struct({
  name: S.string({ pattern: /^[A-Za-z0-9-]{1,64}$/ }),
  value: S.string({ pattern: /^[!-~](?:[ -~]{0,3998}[!-~])?$/ }),
})
export type DeskWakeHeader = S.Infer<typeof DeskWakeHeader>

/** Saved whole each time: no stored address or token is kept. */
export const DeskWakeSetup = S.struct({
  url: S.string({ minLength: 9, maxLength: 2000, pattern: /^https:\/\/\S+$/ }),
  headers: S.array(DeskWakeHeader, { maxItems: DESK_WAKE_HEADERS_MAX }),
  credentialId: CredentialId,
  enabled: S.boolean,
})
export type DeskWakeSetup = S.Infer<typeof DeskWakeSetup>

export const isReservedWakeHeader = (name: string): boolean => RESERVED_HEADERS.test(name)

/** A test wake's status is 0 when the service was not reached. */
export const DeskWakeTest = S.struct({
  status: S.int({ min: 0, max: 599 }),
  outcome: DeskWake.fields.lastStatus,
})
export type DeskWakeTest = S.Infer<typeof DeskWakeTest>

const RESERVED_HEADERS =
  /^(?:host|cookie|connection|keep-alive|upgrade|te|trailer|transfer-encoding|forwarded|content-.*|proxy-.*|x-forwarded-.*)$/i

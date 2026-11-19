import { type HasClock, Task as T } from '@homingbird/kernel'
import { credentialDirectory, serverKey } from './credentials.ts'
import type { CliEnv } from './environment.ts'

export type ClaimEnv = Pick<CliEnv, 'files' | 'variables' | 'homeDirectory'> & HasClock

/**
 * Claims the desk of one member on one server for this computer, unless another runner there holds it
 * and is still alive. Runners started by `homingbird run` and by `homingbird-mcp --run-agent` share it,
 * so two of them never draft for the same person at once.
 */
export const claimDesk = (path: string, holder: string): T.Task<boolean, never, ClaimEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<ClaimEnv>()
    const current = yield* currentClaim(path)
    if (current !== null && current.holder === holder) return yield* renewDeskClaim(path, holder)
    if (current !== null && env.clock.now() - current.heartbeatAt < DESK_CLAIM_STALE_MS) return false
    if (current !== null || (yield* T.promise(() => env.files.exists(path))))
      yield* T.promise(() => env.files.remove(path))
    return yield* T.promise(() => env.files.createExclusive(path, claimText(holder, env.clock.now())))
  })

/** Keeps a claim alive; false when another runner took it over in the meantime. */
export const renewDeskClaim = (path: string, holder: string): T.Task<boolean, never, ClaimEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<ClaimEnv>()
    const current = yield* currentClaim(path)
    if (current !== null && current.holder !== holder) return false
    yield* T.promise(() => env.files.writePrivate(path, claimText(holder, env.clock.now())))
    return true
  })

export const releaseDeskClaim = (path: string, holder: string): T.Task<void, never, ClaimEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<ClaimEnv>()
    if ((yield* currentClaim(path))?.holder === holder) yield* T.promise(() => env.files.remove(path))
  })

/** Whether a runner holds the claim and has renewed it recently. */
export const isClaimLive = (path: string): T.Task<boolean, never, ClaimEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<ClaimEnv>()
    const current = yield* currentClaim(path)
    return current !== null && env.clock.now() - current.heartbeatAt < DESK_CLAIM_STALE_MS
  })

export const deskClaimPath = (
  env: Pick<CliEnv, 'variables' | 'homeDirectory'>,
  serverUrl: string,
  memberId: string,
): string => `${deskFileStem(env, serverUrl, memberId)}.json`

/** The desk files of one member on one server, without their extension. */
export const deskFileStem = (
  env: Pick<CliEnv, 'variables' | 'homeDirectory'>,
  serverUrl: string,
  memberId: string,
): string =>
  `${credentialDirectory(env)}/${DESKS_DIRECTORY}/${encodeURIComponent(serverKey(serverUrl))}~${encodeURIComponent(memberId)}`

export const DESK_CLAIM_STALE_MS = 30_000
export const DESK_HEARTBEAT_MS = 10_000
export const DESK_CLAIM_RETRY_MS = 5_000
export const DESKS_DIRECTORY = 'desks'

interface Claim {
  readonly holder: string
  readonly heartbeatAt: number
}

const currentClaim = (path: string): T.Task<Claim | null, never, ClaimEnv> =>
  T.flatMap((env: ClaimEnv) =>
    T.map((text: string | null) => (text === null ? null : claimIn(text)))(
      T.promise(() => env.files.read(path)),
    ),
  )(T.ask<ClaimEnv>())

const claimIn = (text: string): Claim | null => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { holder, heartbeatAt } = parsed as Record<string, unknown>
    return typeof holder === 'string' && typeof heartbeatAt === 'number' ? { holder, heartbeatAt } : null
  } catch {
    return null
  }
}

const claimText = (holder: string, heartbeatAt: number): string => JSON.stringify({ holder, heartbeatAt })

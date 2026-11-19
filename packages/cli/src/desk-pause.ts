import { type HasClock, Task as T } from '@homingbird/kernel'
import { deskFileStem } from './desk-claim.ts'
import type { CliEnv } from './environment.ts'

export type PauseEnv = Pick<CliEnv, 'files' | 'variables' | 'homeDirectory'> & HasClock

/**
 * Whether the desks of one member on one server are paused on this computer. Every runner there,
 * `homingbird run` and `homingbird-mcp --run-agent` alike, checks it before each note.
 */
export const isDeskPaused = (path: string): T.Task<boolean, never, PauseEnv> =>
  T.flatMap((env: PauseEnv) => env.files.exists(path))(T.ask<PauseEnv>())

/** How every status output words the desk's state, after `Desk:`. */
export const deskStateText = (isPaused: boolean): string =>
  isPaused ? 'paused on this computer (homingbird desk resume to answer again)' : 'on'

/** Pauses the desk; false when it was paused already. */
export const pauseDesk = (path: string): T.Task<boolean, never, PauseEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<PauseEnv>()
    if (yield* isDeskPaused(path)) return false
    yield* env.files.writePrivate(path, `${JSON.stringify({ pausedAt: env.clock.now() })}\n`)
    return true
  })

/** Resumes the desk; false when it was not paused. */
export const resumeDesk = (path: string): T.Task<boolean, never, PauseEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<PauseEnv>()
    if (!(yield* isDeskPaused(path))) return false
    yield* env.files.remove(path)
    return true
  })

export const deskPausePath = (
  env: Pick<CliEnv, 'variables' | 'homeDirectory'>,
  serverUrl: string,
  memberId: string,
): string => `${deskFileStem(env, serverUrl, memberId)}.paused`

/** How often a paused runner looks whether it was resumed. */
export const PAUSE_CHECK_MS = 5_000

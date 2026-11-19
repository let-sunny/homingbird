import { Task as T } from '@homingbird/kernel'
import { type StoredCredential, credentialDirectory, credentialFor } from '../credentials.ts'
import { DESK_HEARTBEAT_MS, claimDesk, releaseDeskClaim, renewDeskClaim } from '../desk-claim.ts'
import type { CliEnv } from '../environment.ts'
import { CliFailure, EXIT } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { serviceLockPath, serviceStopPath } from '../service-definition.ts'
import { apiFor } from '../session.ts'
import { type RunnerSettings, runDesk } from './run.ts'

/**
 * `homingbird run --service`, as the background service starts it. It holds one lock per server on
 * this computer, so a second copy exits; it waits for a sign-in instead of stopping, waits for a new one
 * when the credential is refused, tries again after any other failure or crash, and stops when its
 * stop file appears, which also stops the agent command it is running.
 */
export const runAsService = (
  settings: RunnerSettings,
  report: (step: Outcome) => void,
): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const server = env.server
    if (server === null)
      return yield* T.fail(
        CliFailure({ message: 'run --service needs --server <url>.', exitCode: EXIT.usage }),
      )
    const lock = serviceLockPath(credentialDirectory(env), server)
    const stop = serviceStopPath(credentialDirectory(env), server)
    const holder = env.nonce()
    if (!(yield* claimDesk(lock, holder)))
      return report(
        outcome(
          { step: 'already_running', server },
          `The service for ${server} already runs on this computer; this copy exits.`,
        ),
      )
    yield* T.promise(() => env.files.remove(stop))
    yield* T.ensuring(releaseDeskClaim(lock, holder))(
      T.race([serving(server, settings, report), untilStopped(lock, stop, holder, report)]),
    )
  })

export const signInFirst = (server: string): string => `Sign in first: homingbird login --server ${server}`

export const SIGN_IN_CHECK_MS = 10_000
export const SERVICE_RETRY_MS = 60_000
export const STOP_CHECK_MS = 1_000

const serving = (
  server: string,
  settings: RunnerSettings,
  report: (step: Outcome) => void,
): T.Task<void, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    let refused: string | null = null
    for (;;) {
      const credential: StoredCredential = yield* signedInTo(server, refused, report)
      const session = { credential, api: apiFor(env, credential) }
      const ended = yield* T.exit(runDesk(session, { ...settings, isService: true }, report))
      if (ended._tag === 'Ok') return
      const failure = ended.error._tag === 'Fail' ? ended.error.error : null
      if (failure?.exitCode === EXIT.signedOut) {
        refused = credential.token
        continue
      }
      const reason = failure?.message ?? 'The runner stopped on an unexpected error.'
      report(outcome({ step: 'restarting', reason }, `${reason} Trying again in a minute.`))
      yield* T.sleep(SERVICE_RETRY_MS)
    }
  })

/** Ends when the stop file appears or another copy took the lock; renews the lock meanwhile. */
const untilStopped = (
  lock: string,
  stop: string,
  holder: string,
  report: (step: Outcome) => void,
): T.Task<void, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    for (let waited = 0; ; waited += STOP_CHECK_MS) {
      yield* T.sleep(STOP_CHECK_MS)
      if (yield* T.promise(() => env.files.exists(stop))) {
        yield* T.promise(() => env.files.remove(stop))
        return report(outcome({ step: 'stopping' }, 'Asked to stop; stopping the agent command and exiting.'))
      }
      if (waited % DESK_HEARTBEAT_MS === 0 && !(yield* renewDeskClaim(lock, holder)))
        return report(outcome({ step: 'replaced' }, 'Another copy of the service took over; this one exits.'))
    }
  })

const signedInTo = (
  server: string,
  refused: string | null,
  report: (step: Outcome) => void,
): T.Task<StoredCredential, never, CliEnv> =>
  T.gen(function* () {
    let told = false
    for (;;) {
      const credential = yield* credentialFor(server)
      if (credential !== null && credential.token !== refused) return credential
      if (!told)
        report(
          outcome(
            { step: 'signed_out', server },
            refused === null
              ? `${signInFirst(server)}. This service starts answering once you have.`
              : `The server refused the credential. Sign in again: homingbird login --server ${server}`,
          ),
        )
      told = true
      yield* T.sleep(SIGN_IN_CHECK_MS)
    }
  })

import { type Result, Task as T } from '@homingbird/kernel'
import {
  type StoredCredential,
  credentialDirectory,
  credentialFor,
  readCredentialsFile,
  warnIfShared,
} from '../credentials.ts'
import { DESK_HEARTBEAT_MS, claimDesk, releaseDeskClaim, renewDeskClaim } from '../desk-claim.ts'
import type { CliEnv } from '../environment.ts'
import { CliFailure, EXIT } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { serviceLockPath, serviceMissingPath, serviceStopPath } from '../service-definition.ts'
import { apiFor } from '../session.ts'
import { type RunnerSettings, missingCommandOf, runDesk } from './run.ts'

/**
 * `homingbird run --service`, as the background service starts it. It holds one lock per server on
 * this computer, so a second copy exits; it waits for a sign-in instead of stopping, waits for a new one
 * when the credential is refused, tries again after any other failure or crash, and stops when its
 * stop file appears, which also stops the agent command it is running. Given a credentials file, it
 * waits the same way until that file holds a credential the server accepts.
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
    yield* env.files.remove(stop)
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
    yield* untilCommandsFound(serviceMissingPath(credentialDirectory(env), server), settings, report)
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

/**
 * Waits, saying so once, while a preset's program is missing from the PATH the service runs with. The
 * reason stays in a file beside the lock until the program is found or the service stops.
 */
const untilCommandsFound = (
  marker: string,
  settings: RunnerSettings,
  report: (step: Outcome) => void,
): T.Task<void, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    yield* T.ensuring(env.files.remove(marker))(
      T.gen(function* () {
        let told = false
        for (;;) {
          const missing = yield* missingCommandOf(settings)
          if (missing === null) return
          if (!told) {
            report(outcome({ step: 'command_missing' }, `${missing} The service looks again every minute.`))
            yield* env.files.writePrivate(marker, missing)
          }
          told = true
          yield* T.sleep(SERVICE_RETRY_MS)
        }
      }),
    )
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
      if (yield* env.files.exists(stop)) {
        yield* env.files.remove(stop)
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
    const env = yield* T.ask<CliEnv>()
    const file = env.credentialsFile
    let told = false
    for (;;) {
      const { credential, problem } = file === null ? yield* stored(server) : yield* inFile(file, server)
      if (credential !== null && credential.token !== refused) {
        if (file !== null) yield* warnIfShared(file)
        return credential
      }
      if (!told)
        report(outcome({ step: 'signed_out', server }, signedOutText(server, file, refused, problem)))
      told = true
      yield* T.sleep(SIGN_IN_CHECK_MS)
    }
  })

interface Found {
  readonly credential: StoredCredential | null
  readonly problem: string | null
}

const stored = (server: string): T.Task<Found, never, CliEnv> =>
  T.map((credential: StoredCredential | null) => ({ credential, problem: null }))(credentialFor(server))

const inFile = (file: string, server: string): T.Task<Found, never, CliEnv> =>
  T.map((read: Result.Result<StoredCredential, CliFailure>) =>
    read._tag === 'Ok'
      ? { credential: read.value, problem: null }
      : { credential: null, problem: read.error.message },
  )(T.result(readCredentialsFile(file, server)))

const signedOutText = (
  server: string,
  file: string | null,
  refused: string | null,
  problem: string | null,
): string => {
  if (file === null)
    return refused === null
      ? `${signInFirst(server)}. This service starts answering once you have.`
      : `The server refused the credential. Sign in again: homingbird login --server ${server}`
  if (problem !== null) return `${problem} This service starts answering once it can use the file.`
  return `The server refused the credential in ${file}. Sign in again on your own computer with homingbird login --server ${server} --credentials-file <path>, and replace the file.`
}

import { Task as T } from '@homingbird/kernel'
import { CREDENTIAL_FILES, credentialDirectory } from './credentials.ts'
import type { CliEnv } from './environment.ts'
import { CliFailure, EXIT } from './failure.ts'

export const requireNoApprovalCredential: T.Task<void, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  for (const path of approvalCredentialPaths(env)) {
    const isStored = yield* T.promise(() => env.files.exists(path))
    if (isStored) return yield* T.fail(CliFailure({ message: exposedMessage(path), exitCode: EXIT.unsafe }))
  }
})

export const agentEnvironment = (
  variables: Readonly<Record<string, string | undefined>>,
  secrets: ReadonlyArray<string>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(variables).flatMap(([name, value]) =>
      value === undefined || isWithheld(name, value, secrets) ? [] : [[name, value]],
    ),
  )

const WITHHELD_NAME = /^(?:HOMINGBIRD|HB)_/i

const isWithheld = (name: string, value: string, secrets: ReadonlyArray<string>): boolean =>
  WITHHELD_NAME.test(name) || secrets.some((secret) => secret !== '' && value.includes(secret))

const exposedMessage = (path: string): string =>
  [
    `homingbird run will not start the agent command: an approve-button credential is stored at ${path}.`,
    'The agent command runs as your user and could read that file and approve notes with it.',
    'Run the runner as a separate OS user or in a container, signed in there with `homingbird login --server <url>` and without --approve-button.',
    'Or, if you do not need the approve button on this computer, run `homingbird logout` and sign in again without --approve-button.',
  ].join('\n')

const approvalCredentialPaths = (env: Pick<CliEnv, 'variables' | 'homeDirectory'>): string[] => [
  ...new Set([
    `${credentialDirectory(env)}/${CREDENTIAL_FILES.approval}`,
    `${env.homeDirectory}/.config/homingbird/${CREDENTIAL_FILES.approval}`,
  ]),
]

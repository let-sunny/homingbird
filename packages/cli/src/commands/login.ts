import { type DeviceFlowFailed, awaitDeviceTokens, beginDeviceFlow } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import { countUsage } from '../analytics.ts'
import type { Invocation } from '../arguments.ts'
import { requireNewCredentialsFile, writeCredential, writeCredentialsFile } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import { CliFailure, EXIT, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { apiFor, calling } from '../session.ts'
import { openOnServer, reviewChannelOf, reviewLink } from '../web-client.ts'

type Login = Extract<Invocation, { command: 'login' }>

/**
 * Signs in with the device flow, approved by a person in the web client. The agent credential goes to
 * this device's configuration directory, or, given a credentials file, to that file alone.
 */
export const login = (
  invocation: Login,
  announce: (step: Outcome) => void,
): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const file = env.credentialsFile
    if (file === null && invocation.force)
      return yield* T.fail(
        CliFailure({ message: '--force goes with --credentials-file.', exitCode: EXIT.usage }),
      )
    if (file !== null) yield* requireNewCredentialsFile(file, invocation.force)
    const options = {
      serverUrl: invocation.server,
      clientName: invocation.name ?? `Homingbird CLI on ${env.hostName}`,
      clientKind: env.variables.HOMINGBIRD_CLIENT_KIND === 'plugin' ? ('plugin' as const) : ('cli' as const),
      fetch: env.fetch,
    }
    const authorization = yield* T.mapError(toFailure)(beginDeviceFlow(options))
    const link = authorization.verification_uri_complete
    const opened = invocation.openBrowser ? yield* openOnServer(link, invocation.server) : false
    announce(
      outcome(
        {
          step: 'awaiting_approval',
          verificationUri: link,
          userCode: authorization.user_code,
          expiresInSeconds: authorization.expires_in,
          browserOpened: opened,
        },
        opened
          ? `Opened ${link} in your browser.\nThe code ${authorization.user_code} is filled in there: confirm it to finish.`
          : `Open ${link}\nand confirm the code ${authorization.user_code}`,
      ),
    )
    const tokens = yield* T.mapError(toFailure)(awaitDeviceTokens(options, authorization))
    const agent = { serverUrl: invocation.server, token: tokens.access_token }
    yield* file === null ? writeCredential(agent) : writeCredentialsFile(file, agent, invocation.force)
    const api = apiFor(env, agent)
    const me = yield* calling(api['me.get']({}))
    yield* countUsage(api, 'sign_in_completed', { client: 'cli' })
    const channel = yield* reviewChannelOf(api, me.member)
    if (channel !== null)
      return outcome(
        {
          step: 'signed_in',
          server: invocation.server,
          member: me.member,
          channel,
          ...(file !== null && { credentialsFile: file }),
        },
        channelAgentSignedIn(invocation.server, me.member.name, channel, file),
      )
    const signedIn = `Signed in to ${invocation.server} as ${me.member.name} <${me.member.email}>.`
    if (file !== null)
      return outcome(
        { step: 'signed_in', server: invocation.server, member: me.member, credentialsFile: file },
        `${signedIn}\nWrote the agent credential to ${file}, readable by you only. ${KEEP_THE_FILE}`,
      )
    return outcome(
      { step: 'signed_in', server: invocation.server, member: me.member },
      `${signedIn}\n${ONE_DESK}`,
    )
  })

const channelAgentSignedIn = (server: string, name: string, channel: string, file: string | null): string =>
  [
    `Signed in to ${server} as ${name}, the agent of #${channel}.`,
    file === null
      ? `Run one desk for it here with homingbird run. ${CHANNEL_AGENT_DRAFTS}`
      : `Wrote its credential to ${file}, readable by you only. Give it to one runner with --credentials-file or HOMINGBIRD_CREDENTIALS_FILE; on another machine than the runner’s, move it there as a secret. ${CHANNEL_AGENT_DRAFTS}`,
    `They review its answers at ${reviewLink(server, channel)}`,
  ].join('\n')

const CHANNEL_AGENT_DRAFTS =
  'It can read its channel’s questions and draft answers, never send: one of the channel’s managers approves each.'

const toFailure = (failure: DeviceFlowFailed): CliFailure => failed(failure.message)

const KEEP_THE_FILE =
  'Store it as a secret, give it to one runner with --credentials-file or HOMINGBIRD_CREDENTIALS_FILE, and delete this copy; it can read and draft as you, never send.'

const ONE_DESK =
  'Keep one desk, the one session that answers arriving notes: a Claude Code session with the Homingbird plugin’s pane open, an MCP client started as the desk (homingbird-mcp with --desk or --run-agent), or homingbird run. Other sessions draft only what you ask.'

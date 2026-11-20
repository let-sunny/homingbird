import { type JoinCodeRefused, redeemJoinCode } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import { countUsage } from '../analytics.ts'
import type { Invocation } from '../arguments.ts'
import { requireNewCredentialsFile, writeCredential, writeCredentialsFile } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { apiFor, calling } from '../session.ts'
import { reviewChannelOf, reviewLink } from '../web-client.ts'
import { AS_THE_PERSON, type ServiceOptions, installService } from './service.ts'

type Setup = Extract<Invocation, { command: 'setup' }>

/**
 * Sets up an always-on agent on this computer in one command: it redeems a join code made in the web
 * client for an agent credential, stores it where `homingbird login` would, and installs the
 * background service. The token is never printed.
 */
export const setup = (invocation: Setup): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const file = env.credentialsFile
    if (invocation.service !== null && env.userId === 0) return yield* T.fail(failed(AS_THE_PERSON))
    if (file !== null) yield* requireNewCredentialsFile(file, invocation.force)
    const tokens = yield* T.mapError(refused)(
      redeemJoinCode({
        serverUrl: invocation.server,
        code: invocation.code,
        clientName: invocation.name ?? `Homingbird on ${env.hostName}`,
        clientKind: 'cli',
        fetch: env.fetch,
      }),
    )
    const agent = { serverUrl: invocation.server, token: tokens.access_token }
    yield* file === null ? writeCredential(agent) : writeCredentialsFile(file, agent, invocation.force)
    const api = apiFor(env, agent)
    const me = yield* calling(api['me.get']({}))
    yield* countUsage(api, 'sign_in_completed', { client: 'cli' })
    const channel = yield* reviewChannelOf(api, me.member)
    const signedIn = {
      server: invocation.server,
      member: me.member,
      ...(channel !== null && { channel }),
      ...(file !== null && { credentialsFile: file }),
    }
    const who =
      channel === null
        ? `Signed in to ${invocation.server} as ${me.member.name}.`
        : `Signed in to ${invocation.server} as ${me.member.name}, the agent of #${channel}.`
    const next = nextStep(invocation.server, channel)
    if (invocation.service === null)
      return outcome(
        { step: 'signed_in', ...signedIn },
        `${who}\nStart its desk here with: ${serviceCommand(invocation.server, null)}`,
      )
    const installed = yield* T.result(
      T.provide({ server: invocation.server })(installService(invocation.service)),
    )
    if (installed._tag === 'Err')
      return yield* T.fail(
        failed(
          `${who} The credential is saved, but the service was not installed: ${installed.error.message}\nFix that, then run: ${serviceCommand(invocation.server, invocation.service)}`,
        ),
      )
    return outcome(
      { step: 'set_up', ...signedIn, service: installed.value.json },
      `${who}\n${installed.value.text}\nNext: ${next}`,
    )
  })

const nextStep = (server: string, channel: string | null): string =>
  channel === null
    ? `notes that arrive for you are drafted here and wait for your approval at ${server}. Check the service with homingbird service status.`
    : `its answers wait for the channel’s managers at ${reviewLink(server, channel)}. Check the service with homingbird service status.`

const serviceCommand = (server: string, service: ServiceOptions | null): string =>
  `homingbird service install --server ${server} --agent ${service === null ? '<command or preset>' : quoted(service.agent)}`

const quoted = (agent: string): string =>
  /^[\w.-]+$/.test(agent) ? agent : `"${agent.replace(/"/g, '\\"')}"`

const refused = (refusal: JoinCodeRefused): CliFailure => failed(refusal.message)

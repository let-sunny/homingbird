import { type DeviceFlowFailed, awaitDeviceTokens, beginDeviceFlow } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import type { Invocation } from '../arguments.ts'
import { removeCredential, writeCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { apiFor, calling } from '../session.ts'
import { openOnServer } from '../web-client.ts'

type Login = Extract<Invocation, { command: 'login' }>

export const login = (
  invocation: Login,
  announce: (step: Outcome) => void,
): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const options = {
      serverUrl: invocation.server,
      clientName: invocation.name ?? `Homingbird CLI on ${env.hostName}`,
      wantsApproval: invocation.approveButton,
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
    yield* writeCredential('agent', agent)
    if (tokens.approval_token === undefined) yield* removeCredential('approval')
    else yield* writeCredential('approval', { serverUrl: invocation.server, token: tokens.approval_token })
    const me = yield* calling(apiFor(env, agent)['me.get']({}))
    const hasApproveButton = tokens.approval_token !== undefined
    return outcome(
      { step: 'signed_in', server: invocation.server, member: me.member, hasApproveButton },
      `Signed in to ${invocation.server} as ${me.member.name} <${me.member.email}>.${
        invocation.approveButton && !hasApproveButton
          ? '\nThe approve button was not granted; approve notes in the web client.'
          : ''
      }`,
    )
  })

const toFailure = (failure: DeviceFlowFailed): CliFailure => failed(failure.message)

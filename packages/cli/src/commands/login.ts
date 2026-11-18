import { type DeviceFlowFailed, awaitDeviceTokens, beginDeviceFlow } from '@homingbird/client'
import { type Result, Task as T } from '@homingbird/kernel'
import type { Api, ServerInfo } from '@homingbird/protocol'
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
    const api = apiFor(env, agent)
    const me = yield* calling(api['me.get']({}))
    const hasApproveButton = tokens.approval_token !== undefined
    const missing = invocation.approveButton && !hasApproveButton
    const turnedOff = missing && (yield* approveButtonTurnedOff(api))
    return outcome(
      {
        step: 'signed_in',
        server: invocation.server,
        member: me.member,
        hasApproveButton,
        ...(missing && { approveButton: !turnedOff }),
      },
      `Signed in to ${invocation.server} as ${me.member.name} <${me.member.email}>.${
        turnedOff
          ? '\nThe organization has turned the approve button off; approve notes in the web client.'
          : missing
            ? '\nThe approve button was not granted; approve notes in the web client.'
            : ''
      }\n${ONE_DESK}`,
    )
  })

const approveButtonTurnedOff = (api: Api): T.Task<boolean> =>
  T.map((info: Result.Result<ServerInfo, unknown>) => info._tag === 'Ok' && !info.value.approveButton)(
    T.result(api['server.info']({})),
  )

const toFailure = (failure: DeviceFlowFailed): CliFailure => failed(failure.message)

const ONE_DESK =
  'Keep one desk session: one Claude Code session with the mod, one homingbird-mcp --desk, or one homingbird run answers arriving notes; other sessions draft only what you ask.'

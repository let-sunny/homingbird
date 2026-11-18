import { Task as T } from '@homingbird/kernel'
import { readCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { apiFor, calling } from '../session.ts'

export const status: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  const agent = yield* readCredential('agent')
  const hasApproveButton = (yield* readCredential('approval')) !== null
  if (agent === null) return outcome({ signedIn: false }, 'Not signed in.')
  const api = apiFor(env, agent)
  const me = yield* calling(api['me.get']({}))
  const info = yield* calling(api['server.info']({}))
  return outcome(
    {
      signedIn: true,
      server: agent.serverUrl,
      member: me.member,
      credential: me.credential,
      locale: me.locale ?? null,
      approveButton: info.approveButton,
      hasApproveButton,
      transport: TRANSPORT,
    },
    [
      `Server:         ${agent.serverUrl}`,
      `Signed in as:   ${me.member.name} <${me.member.email}>`,
      `Credential:     ${me.credential.name} (${me.credential.kind})`,
      `Approve button: ${approveButtonState(info.approveButton, hasApproveButton)}`,
      `Language:       ${me.locale ?? 'follows the browser'}`,
      `Transport:      ${TRANSPORT}`,
    ].join('\n'),
  )
})

const approveButtonState = (allowed: boolean, onThisDevice: boolean): string =>
  !allowed ? APPROVE_BUTTON_OFF : onThisDevice ? 'granted on this device' : 'not on this device'

const APPROVE_BUTTON_OFF = 'the organization has turned the approve button off'

const TRANSPORT = 'server-sent events, falling back to long-poll'

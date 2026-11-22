import { Task as T } from '@homingbird/kernel'
import { Conflict, Invalid, NotFound, type SlackCredentialsInput } from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { deleteSlackCredentials, sealSlackCredentials } from './slack-credentials.ts'
import type { SlackCallFailure } from './slack-web-api.ts'
import { forgetTokenRefused, pinnedWorkspace, rememberSlackIdentity } from './slack-workspace.ts'

/** Keeps only a token Slack accepts, of this server's workspace, asked outside any transaction. */
export const setSlackCredentials = (
  caller: Caller,
  values: SlackCredentialsInput,
): T.Task<void, Invalid | Conflict, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (env.config.slack !== null) return yield* T.fail(Conflict({ message: FROM_ENVIRONMENT }))
    const key = env.config.secretsKey
    if (key === null) return yield* T.fail(Invalid({ message: NO_KEY }))
    const identity = yield* T.catchAll((failure: SlackCallFailure) =>
      T.fail(Invalid({ message: refusalOf(failure) })),
    )(env.slackApi(values.botToken).authTest())
    const workspace = yield* pinnedWorkspace
    if (workspace !== null && workspace.team_id !== identity.teamId)
      return yield* T.fail(Conflict({ message: otherWorkspace(workspace.team_name) }))
    yield* transact(
      T.gen(function* () {
        yield* sealSlackCredentials(key, caller.member.id, values)
        yield* rememberSlackIdentity(identity)
      }),
    )
  })

export const removeSlackCredentials: T.Task<void, NotFound, RequestEnv> = T.gen(function* () {
  if (!(yield* deleteSlackCredentials))
    return yield* T.fail(NotFound({ message: 'No Slack app values are stored.' }))
  yield* forgetTokenRefused
})

const FROM_ENVIRONMENT =
  'The Slack app’s values come from the server’s environment, HB_SLACK_BOT_TOKEN and HB_SLACK_SIGNING_SECRET; change them there.'
const NO_KEY = 'This server has no HB_SECRETS_KEY to keep the Slack app’s values with.'

const otherWorkspace = (team: string): string =>
  `This bot token belongs to another Slack workspace. This server answers only ${team}.`

const refusalOf = (failure: SlackCallFailure): string =>
  failure._tag === 'SlackRefused'
    ? `Slack refused the bot token (${failure.error.replace(/[^a-z_]/g, '').slice(0, 60)}).`
    : 'Slack could not be reached to check the bot token. Try again.'

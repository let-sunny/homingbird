import { Task as T } from '@homingbird/kernel'
import { type Api, type ApiError, type RouteName, contract } from '@homingbird/protocol'
import { invalidParams } from './json-rpc.ts'
import { type LocalSession, SIGN_IN_FIRST } from './local-session.ts'
import type { Prompt } from './prompts.ts'

export interface LocalTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly readOnly: boolean
  readonly run: T.Task<string>
}

export interface LocalAdapter {
  readonly tools: ReadonlyArray<LocalTool>
  readonly prompts: ReadonlyArray<Prompt>
  readonly blockedBecause: () => string | null
}

export const localAdapterOf = (session: LocalSession, desk: DeskSwitch | null = null): LocalAdapter => ({
  tools: [
    {
      name: 'login',
      title: 'Sign in to Homingbird',
      description:
        'Starts signing this agent in to Homingbird. Opens the browser where your human signs in and confirms with one click, and returns at once: call status afterwards. It never returns a credential.',
      readOnly: false,
      run: session.login,
    },
    {
      name: 'status',
      title: 'Homingbird sign-in status',
      description:
        'Says whether this agent is signed out, waiting for approval in the browser, or signed in and as whom.',
      readOnly: true,
      run: session.status,
    },
    {
      name: 'logout',
      title: 'Sign out of Homingbird',
      description:
        'Signs this agent out: revokes its credential on the server and removes it from this device.',
      readOnly: false,
      run: session.logout,
    },
  ],
  prompts: [
    {
      name: 'login',
      title: 'Log in to Homingbird',
      description: 'Sign this agent in to Homingbird through your browser.',
      arguments: [],
      text: () =>
        'Call the login tool to sign in to Homingbird. If the browser did not open, show me the link and the code it returned. Then call status and tell me whether I am signed in.',
    },
    {
      name: 'desk',
      title: 'Turn my Homingbird desk on or off',
      description:
        'Pauses or resumes the desk this app runs with the agent command from your MCP configuration. It takes no command.',
      arguments: [{ name: 'state', description: 'on or off', required: true }],
      text: ({ state = '' }) => {
        const wanted = state.trim().toLowerCase()
        if (wanted !== 'on' && wanted !== 'off')
          return T.fail(invalidParams('The desk prompt takes on or off.'))
        return desk === null ? T.succeed(NO_DESK_RUNNER) : desk.turn(wanted === 'on')
      },
    },
  ],
  blockedBecause: () => {
    const state = session.state()
    if (state.kind === 'signed_in') return null
    return state.kind === 'pending'
      ? `Not signed in yet: waiting for approval in the browser. Open ${state.verificationUri} and confirm the code ${state.userCode}, then try again.`
      : SIGN_IN_FIRST
  },
})

/** Pauses and resumes the desk runner configured for this app; it never takes or shows a command. */
export interface DeskSwitch {
  readonly turn: (on: boolean) => T.Task<string>
}

export const NO_DESK_RUNNER =
  'Tell me in one line: this app runs no Homingbird desk. To run one, I add --run-agent followed by my agent command, such as "claude -p", to the homingbird-mcp entry in my MCP configuration (or set HOMINGBIRD_RUN_AGENT) and restart the app.'

export const noticingRefusals = (api: Api, session: LocalSession): Api =>
  Object.fromEntries(
    (Object.keys(contract) as RouteName[]).map((name) => [
      name,
      (request: never) =>
        T.tapError((error: ApiError) =>
          T.sync(() => {
            if (error._tag === 'Unauthorized') session.credentialWasRefused()
          }),
        )((api[name] as (request: never) => T.Task<unknown, ApiError>)(request)),
    ]),
  ) as unknown as Api

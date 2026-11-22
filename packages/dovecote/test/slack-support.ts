import { Task as T } from '@homingbird/kernel'
import { slackSignatureOf } from '../src/slack/slack-signature.ts'
import { checkSlackWorkspace } from '../src/slack/slack-workspace.ts'
import { type TestResponse, type TestServer, startTestServer } from './harness.ts'

export const SLACK_BOT_TOKEN = 'xoxb-1234-5678-botsecretvalue'
export const SLACK_SIGNING_SECRET = '8f742231b10e8888abcd99eeefff85a5'
export const TEAM_ID = 'T0ACME'
export const BOT_USER_ID = 'U0BOT'
export const BOT_ID = 'B0BOT'

export interface FakeSlackUser {
  readonly id: string
  readonly name: string
  readonly email?: string
  readonly guest?: true
  readonly teamId?: string
}

/** A Slack workspace: it answers the Web API methods Homingbird calls and records every call. */
export interface FakeSlack {
  readonly calls: Array<{ readonly method: string; readonly fields: Readonly<Record<string, string>> }>
  readonly users: Map<string, FakeSlackUser>
  /** The error the next call of a method answers with, once. */
  readonly refuseNext: (method: string, error: string) => void
  /** Makes the bot token one of another workspace from now on. */
  readonly moveTokenTo: (teamId: string) => void
  readonly posted: () => ReadonlyArray<Readonly<Record<string, string>>>
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>
}

export const fakeSlack = (users: ReadonlyArray<FakeSlackUser> = []): FakeSlack => {
  const calls: FakeSlack['calls'] = []
  const byId = new Map(users.map((user) => [user.id, user]))
  const refusals = new Map<string, string>()
  let ts = 1_700_000_000
  let tokenTeam = TEAM_ID
  const userJson = (user: FakeSlackUser) => ({
    id: user.id,
    team_id: user.teamId ?? TEAM_ID,
    name: user.name.toLowerCase(),
    real_name: user.name,
    is_restricted: user.guest === true,
    profile: { display_name: user.name, ...(user.email !== undefined && { email: user.email }) },
  })
  const answer = (method: string, fields: Readonly<Record<string, string>>): unknown => {
    const refused = refusals.get(method)
    if (refused !== undefined) {
      refusals.delete(method)
      return { ok: false, error: refused }
    }
    if (method === 'auth.test')
      return { ok: true, team: 'Acme', team_id: tokenTeam, user_id: BOT_USER_ID, bot_id: BOT_ID }
    if (method === 'users.lookupByEmail') {
      const found = [...byId.values()].find((user) => user.email === fields.email)
      return found === undefined
        ? { ok: false, error: 'users_not_found' }
        : { ok: true, user: userJson(found) }
    }
    if (method === 'users.info') {
      const found = byId.get(fields.user ?? '')
      return found === undefined
        ? { ok: false, error: 'user_not_found' }
        : { ok: true, user: userJson(found) }
    }
    if (method === 'conversations.open') return { ok: true, channel: { id: `D${fields.users}` } }
    if (method === 'chat.postMessage') {
      ts += 1
      return { ok: true, channel: fields.channel, ts: `${ts}.000100` }
    }
    return { ok: true }
  }
  return {
    calls,
    users: byId,
    refuseNext: (method, error) => void refusals.set(method, error),
    moveTokenTo: (teamId) => {
      tokenTeam = teamId
    },
    posted: () => calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.fields),
    fetch: async (url, init) => {
      if (!url.startsWith('https://slack.com/api/')) return new Response('', { status: 201 })
      const method = url.slice('https://slack.com/api/'.length)
      const fields = Object.fromEntries(new URLSearchParams((init?.body as string) ?? ''))
      calls.push({ method, fields })
      return new Response(JSON.stringify(answer(method, fields)), { status: 200 })
    },
  }
}

export const SLACK_VARIABLES = {
  HB_FEATURES: 'slack=on',
  HB_SLACK_BOT_TOKEN: SLACK_BOT_TOKEN,
  HB_SLACK_SIGNING_SECRET: SLACK_SIGNING_SECRET,
}

/** A server with Slack on and its workspace connected, as the check at start leaves it. */
export const startSlackServer = async (
  slack: FakeSlack,
  overrides: Readonly<Record<string, string>> = {},
): Promise<TestServer> => {
  const server = await startTestServer({ ...SLACK_VARIABLES, ...overrides }, { fetch: slack.fetch })
  await connectWorkspace(server)
  return server
}

export const connectWorkspace = (server: TestServer): Promise<void> =>
  T.runPromise(checkSlackWorkspace, server.env)

/** Sends Slack's signed request to the events address, as Slack would at the server's current time. */
export const sendSlackEvent = (
  server: TestServer,
  payload: unknown,
  options: { readonly signedAt?: number; readonly secret?: string } = {},
): Promise<TestResponse> => {
  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor((options.signedAt ?? server.env.clock.now()) / 1000))
  return server.request('POST', '/slack/events', {
    body: payload,
    headers: {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': slackSignatureOf(options.secret ?? SLACK_SIGNING_SECRET, timestamp, body),
    },
  })
}

let eventNumber = 0

/** One event of the workspace, wrapped as Slack wraps it. */
export const slackEvent = (event: Readonly<Record<string, unknown>>, teamId = TEAM_ID) => {
  eventNumber += 1
  return { type: 'event_callback', team_id: teamId, event_id: `Ev${eventNumber}`, event_time: 1, event }
}

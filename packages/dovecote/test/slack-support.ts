import { Task as T } from '@homingbird/kernel'
import { slackSignatureOf } from '../src/slack/slack-signature.ts'
import { checkSlackWorkspace } from '../src/slack/slack-workspace.ts'
import { type Session, type TestResponse, type TestServer, startTestServer } from './harness.ts'

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
  readonly channels: Map<string, FakeSlackChannel>
  /** The error the next call of a method answers with, once. */
  readonly refuseNext: (method: string, error: string) => void
  /** The next call of a method reaches Slack, which acts on it, but its answer is lost on the way back. */
  readonly loseAnswerNext: (method: string) => void
  /** Answers the next call of a method with this status and headers, such as 429 and Retry-After. */
  readonly answerNextWith: (method: string, status: number, headers?: Record<string, string>) => void
  /** Makes the bot token one of another workspace from now on. */
  readonly moveTokenTo: (teamId: string) => void
  readonly posted: () => ReadonlyArray<Readonly<Record<string, string>>>
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>
}

export interface FakeSlackChannel {
  readonly name: string
  readonly isPrivate?: true
  readonly isExternal?: true
  readonly members?: number
}

export const fakeSlack = (
  users: ReadonlyArray<FakeSlackUser> = [],
  channels: Readonly<Record<string, FakeSlackChannel>> = { C0HELP: { name: 'billing-help', members: 12 } },
): FakeSlack => {
  const calls: FakeSlack['calls'] = []
  const rooms = new Map(Object.entries(channels))
  const byId = new Map(users.map((user) => [user.id, user]))
  const refusals = new Map<string, string>()
  const lost = new Set<string>()
  const statuses = new Map<string, { status: number; headers: Record<string, string> }>()
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
    if (method === 'conversations.info') {
      const room = rooms.get(fields.channel ?? '')
      return room === undefined
        ? { ok: false, error: 'channel_not_found' }
        : {
            ok: true,
            channel: {
              id: fields.channel,
              name: room.name,
              is_private: room.isPrivate === true,
              is_ext_shared: room.isExternal === true,
              num_members: room.members ?? 3,
            },
          }
    }
    if (method === 'conversations.replies')
      return {
        ok: true,
        messages: calls
          .filter((call) => call.method === 'chat.postMessage' && call.fields.thread_ts === fields.ts)
          .map((call, index) => ({ ts: `${fields.ts}${index}`, bot_id: BOT_ID, text: call.fields.text })),
      }
    if (method === 'chat.postMessage') {
      ts += 1
      return { ok: true, channel: fields.channel, ts: `${ts}.000100` }
    }
    return { ok: true }
  }
  return {
    calls,
    users: byId,
    channels: rooms,
    refuseNext: (method, error) => void refusals.set(method, error),
    loseAnswerNext: (method) => void lost.add(method),
    answerNextWith: (method, status, headers = {}) => void statuses.set(method, { status, headers }),
    moveTokenTo: (teamId) => {
      tokenTeam = teamId
    },
    posted: () => calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.fields),
    fetch: async (url, init) => {
      if (!url.startsWith('https://slack.com/api/')) return new Response('', { status: 201 })
      const method = url.slice('https://slack.com/api/'.length)
      const fields = Object.fromEntries(new URLSearchParams((init?.body as string) ?? ''))
      const status = statuses.get(method)
      if (status !== undefined) {
        statuses.delete(method)
        return new Response('{"ok":false,"error":"ratelimited"}', status)
      }
      calls.push({ method, fields })
      const answered = answer(method, fields)
      if (lost.delete(method)) throw new TypeError('fetch failed')
      return new Response(JSON.stringify(answered), { status: 200 })
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

/** The code in the link the app last sent in Slack, to a person or in a message only they see. */
export const lastCodeIn = (slack: FakeSlack): string => {
  const sent = [...slack.calls].reverse().find((call) => /chat\.post/.test(call.method))!
  return /#\/slack\/link\/([A-Za-z0-9_-]+)/.exec(sent.fields.text!)![1]!
}

/** Links a person to their Slack user, as Connect Slack and the link in Slack do. */
export const linkPerson = async (server: TestServer, slack: FakeSlack, person: Session): Promise<void> => {
  await server.clock.advance(61_000)
  await person.api('POST', '/me/slack/connect', {})
  await person.api('POST', '/me/slack/link', { code: lastCodeIn(slack) })
}

/**
 * Links a Slack channel to a channel the person manages: they mention the app with link there, and
 * confirm the code in the web client. They must be linked to `slackUser` first.
 */
export const linkChannel = async (
  server: TestServer,
  slack: FakeSlack,
  person: Session,
  slackUser: string,
  slug: string,
  slackChannel = 'C0HELP',
): Promise<TestResponse> => {
  await sendSlackEvent(
    server,
    slackEvent({
      type: 'app_mention',
      user: slackUser,
      text: '<@U0BOT> link',
      channel: slackChannel,
      ts: `${eventNumber}.1`,
    }),
  )
  await server.slackPass()
  return person.api('POST', `/channels/${slug}/slack`, { code: lastCodeIn(slack) })
}

let messageNumber = 100

/** A question asked in Slack: a mention of the app, in a thread when `threadTs` names one. */
export const askInSlack = async (
  server: TestServer,
  user: string,
  text: string,
  options: { readonly channel?: string; readonly threadTs?: string; readonly ts?: string } = {},
): Promise<string> => {
  messageNumber += 1
  const ts = options.ts ?? `1700000${messageNumber}.000200`
  await sendSlackEvent(
    server,
    slackEvent({
      type: 'app_mention',
      user,
      text: `<@${BOT_USER_ID}> ${text}`,
      channel: options.channel ?? 'C0HELP',
      ts,
      ...(options.threadTs !== undefined && { thread_ts: options.threadTs }),
    }),
  )
  await server.slackPass()
  return ts
}

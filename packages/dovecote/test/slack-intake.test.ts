import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, storedRows } from './harness.ts'
import {
  BOT_USER_ID,
  type FakeSlack,
  connectWorkspace,
  fakeSlack,
  sendSlackEvent,
  slackEvent,
  startSlackServer,
} from './slack-support.ts'

let server: TestServer
let slack: FakeSlack
let ana: Session

beforeEach(async () => {
  slack = fakeSlack([
    { id: 'U0ANA', name: 'Ana Silva', email: 'ana@example.com' },
    { id: 'U0GUS', name: 'Gus', guest: true },
    { id: 'U0FAR', name: 'Far', teamId: 'T0OTHER' },
  ])
  server = await startSlackServer(slack)
  ana = await server.signIn('ana@example.com', 'Ana')
})

afterEach(() => server?.close())

const mention = (user: string | undefined, text: string, extra: Record<string, unknown> = {}) =>
  slackEvent({
    type: 'app_mention',
    ...(user !== undefined && { user }),
    text,
    channel: 'C1',
    ts: '5.0',
    ...extra,
  })

const receive = async (payload: unknown) => {
  await sendSlackEvent(server, payload)
  await server.slackPass()
}

const ephemerals = () =>
  slack.calls.filter((call) => call.method === 'chat.postEphemeral').map((call) => call.fields)

describe('the pass over the events Slack sent', () => {
  it('answers a full member who mentions the app with link, to them only, with a code to confirm', async () => {
    await receive(mention('U0ANA', `<@${BOT_USER_ID}> link`, { thread_ts: '4.0' }))
    const [offer] = ephemerals()
    expect(offer).toMatchObject({ channel: 'C1', user: 'U0ANA', thread_ts: '4.0' })
    const code = /#\/slack\/link\/([A-Za-z0-9_-]+)/.exec(offer!.text!)![1]!
    expect((await ana.api('POST', '/me/slack/link', { code })).json).toMatchObject({
      link: { slackName: 'Ana Silva' },
    })
    slack.refuseNext('conversations.info', 'channel_not_found')
    await receive(mention('U0ANA', 'Link.'))
    expect(ephemerals()).toHaveLength(1)
  })

  it('tells a guest and someone of another workspace that only full members are answered', async () => {
    await receive(mention('U0GUS', 'link'))
    await receive(mention('U0FAR', 'link'))
    expect(ephemerals().map((each) => each.text)).toEqual([
      'Homingbird answers full members of Acme only.',
      'Homingbird answers full members of Acme only.',
    ])
    expect(await storedRows(server, 'slack_codes')).toEqual([])
  })

  it('drops the app’s own messages and other apps’, and says a channel is not linked when asked there', async () => {
    await receive(mention(BOT_USER_ID, 'link'))
    await receive(mention('U0ANA', 'link', { bot_id: 'B0OTHER' }))
    await receive(mention(undefined, 'link'))
    await receive(mention('U0ANA', 'please linkify this'))
    await receive(mention('U0NOBODY', 'link'))
    expect(ephemerals().map((each) => each.text)).toEqual([
      'This channel is not linked to Homingbird. A manager of a Homingbird channel links it by mentioning @Homingbird with the word link.',
    ])
  })

  it('handles each event once, deletes its payload at once and its id a day later', async () => {
    await receive(mention('U0ANA', 'link'))
    await server.slackPass()
    expect(ephemerals()).toHaveLength(1)
    const [row] = await storedRows(server, 'slack_events')
    expect(row).toMatchObject({ payload: null })
    expect(row!.processed_at).not.toBeNull()
    await server.clock.advance(24 * 60 * 60_000 + 1)
    await server.slackPass()
    expect(await storedRows(server, 'slack_events')).toEqual([])
  })

  it('stops Slack when the app is uninstalled or its bot token revoked', async () => {
    await receive(slackEvent({ type: 'tokens_revoked', tokens: { oauth: ['U1'], bot: [] } }))
    expect((await storedRows(server, 'slack_workspaces'))[0]).toMatchObject({ state: 'connected' })
    await receive(slackEvent({ type: 'app_uninstalled' }))
    expect((await storedRows(server, 'slack_workspaces'))[0]).toMatchObject({
      state: 'stopped',
      stopped_because: 'revoked',
    })
    await connectWorkspace(server)
    await receive(slackEvent({ type: 'tokens_revoked', tokens: { bot: [BOT_USER_ID] } }))
    expect((await storedRows(server, 'slack_workspaces'))[0]).toMatchObject({ state: 'stopped' })
  })

  it('leaves events waiting while Slack is stopped', async () => {
    await sendSlackEvent(server, mention('U0ANA', 'link'))
    slack.refuseNext('auth.test', 'invalid_auth')
    await connectWorkspace(server)
    await server.slackPass()
    expect((await storedRows(server, 'slack_events'))[0]).toMatchObject({ processed_at: null })
  })

  it('follows a linked person’s new Slack name, and unlinks them when their Slack user is deactivated', async () => {
    await receive(mention('U0ANA', 'link'))
    const code = /#\/slack\/link\/([A-Za-z0-9_-]+)/.exec(ephemerals()[0]!.text!)![1]!
    await ana.api('POST', '/me/slack/link', { code })
    await receive(
      slackEvent({ type: 'user_change', user: { id: 'U0ANA', profile: { display_name: 'Ana S.' } } }),
    )
    expect((await ana.api('GET', '/me/slack')).json.link.slackName).toBe('Ana S.')
    await receive(slackEvent({ type: 'user_change', user: { id: 'U0ANA', deleted: true } }))
    expect((await ana.api('GET', '/me/slack')).json.link).toBeNull()
    const [row] = (await storedRows(server, 'audit_events')).filter(
      (each) => each.event === 'slack.person.unlinked',
    )
    expect(JSON.parse(String(row!.detail))).toEqual({ because: 'slack_deactivated' })
  })
})

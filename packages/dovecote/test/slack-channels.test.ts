import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, storeChannelAsPrivate, storedRows } from './harness.ts'
import {
  BOT_USER_ID,
  type FakeSlack,
  fakeSlack,
  lastCodeIn,
  linkChannel,
  linkPerson,
  sendSlackEvent,
  slackEvent,
  startSlackServer,
} from './slack-support.ts'

let server: TestServer
let slack: FakeSlack
let ana: Session
let ben: Session

beforeEach(async () => {
  slack = fakeSlack(
    [
      { id: 'U0ANA', name: 'Ana Silva', email: 'ana@example.com' },
      { id: 'U0BEN', name: 'Ben', email: 'ben@example.com' },
    ],
    {
      C0HELP: { name: 'billing-help', members: 12 },
      C0SECRET: { name: 'payroll', isPrivate: true, members: 4 },
      C0SHARED: { name: 'partners', isExternal: true },
    },
  )
  server = await startSlackServer(slack)
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })
  await linkPerson(server, slack, ana)
})

afterEach(() => server.close())

const auditOf = async (event: string) =>
  (await storedRows(server, 'audit_events')).filter((row) => row.event === event)

describe('linking a Slack channel to a channel', () => {
  it('links it for a manager who asked in Slack, shows it to the room, and says so in Slack', async () => {
    const linked = await linkChannel(server, slack, ana, 'U0ANA', 'billing')
    expect(linked.status).toBe(200)
    expect(linked.json.link).toEqual({
      tool: 'slack',
      name: 'billing-help',
      isPrivate: false,
      memberCount: 12,
      state: 'active',
    })
    const [link] = await storedRows(server, 'slack_channel_links')
    expect(link).toMatchObject({ slack_channel_id: 'C0HELP', state: 'active', linked_by: ana.me.member.id })
    const [member] = (await storedRows(server, 'members')).filter((row) => row.id === link!.link_member_id)
    expect(member).toMatchObject({ kind: 'chat_link', name: 'Slack #billing-help', status: 'active' })
    expect(slack.posted().at(-1)).toMatchObject({ channel: 'C0HELP' })
    expect(slack.posted().at(-1)!.text).toContain('linked to Homingbird #billing')
    expect(JSON.parse(String((await auditOf('slack.channel.linked'))[0]!.detail))).toEqual({
      slackChannel: 'C0HELP',
      isPrivate: false,
    })
    expect((await ben.api('GET', '/channels/billing')).json.link).toBeUndefined()
    await ben.api('PUT', '/channels/billing/membership')
    expect((await ben.api('GET', '/channels/billing')).json.link.name).toBe('billing-help')
  })

  it('names the channels a person may choose on the code’s page, private ones only for a private Slack channel', async () => {
    await ana.api('POST', '/channels', { slug: 'payroll', description: 'Payroll' })
    await storeChannelAsPrivate(server, 'payroll')
    await sendSlackEvent(
      server,
      slackEvent({ type: 'app_mention', user: 'U0ANA', text: 'link', channel: 'C0SECRET', ts: '9.1' }),
    )
    await server.slackPass()
    const code = lastCodeIn(slack)
    expect((await ana.api('GET', `/slack/codes/${code}`)).json).toMatchObject({
      kind: 'channel',
      slackName: 'Ana Silva',
      channel: { name: 'payroll', isPrivate: true, memberCount: 4, choices: ['payroll'] },
    })
    expect((await ana.api('POST', '/channels/billing/slack', { code })).status).toBe(409)
    expect((await ana.api('POST', '/channels/payroll/slack', { code })).status).toBe(200)
  })

  it('never links a channel shared with another organization', async () => {
    await sendSlackEvent(
      server,
      slackEvent({ type: 'app_mention', user: 'U0ANA', text: 'link', channel: 'C0SHARED', ts: '9.2' }),
    )
    await server.slackPass()
    const offer = slack.calls.filter((call) => call.method === 'chat.postEphemeral').at(-1)!
    expect(offer.fields.text).toBe(
      'A channel shared with another organization cannot be linked to Homingbird.',
    )
  })

  it('lets only a manager link or unlink, an administrator outside the group included', async () => {
    await linkPerson(server, slack, ben)
    await ben.api('PUT', '/channels/billing/membership')
    expect((await linkChannel(server, slack, ben, 'U0BEN', 'billing')).status).toBe(403)
    await linkChannel(server, slack, ana, 'U0ANA', 'billing')
    expect((await ben.api('DELETE', '/channels/billing/slack')).status).toBe(403)
    expect(await storedRows(server, 'slack_channel_links')).toHaveLength(1)
  })

  it('refuses a second link either way, and a code used or past its time', async () => {
    await linkChannel(server, slack, ana, 'U0ANA', 'billing')
    await sendSlackEvent(
      server,
      slackEvent({ type: 'app_mention', user: 'U0ANA', text: 'link', channel: 'C0HELP', ts: '9.4' }),
    )
    await server.slackPass()
    expect(slack.calls.filter((call) => call.method === 'chat.postEphemeral').at(-1)!.fields.text).toContain(
      'linked to Homingbird #billing',
    )
    await ana.api('POST', '/channels', { slug: 'refunds', description: 'Refunds' })
    await sendSlackEvent(
      server,
      slackEvent({ type: 'app_mention', user: 'U0ANA', text: 'link', channel: 'C0SECRET', ts: '9.5' }),
    )
    await server.slackPass()
    const code = lastCodeIn(slack)
    await ana.api('POST', '/channels/payroll-x/slack', { code })
    expect((await ana.api('POST', '/channels/billing/slack', { code })).status).toBe(409)
    await server.clock.advance(10 * 60_000 + 1)
    await ana.api('PATCH', '/admin/channels/refunds', { description: 'Refunds, private' })
    expect((await ana.api('POST', '/channels/refunds/slack', { code })).status).toBe(404)
  })

  it('unlinks for a manager, with Slack off too, keeping the notes that arrived', async () => {
    await linkChannel(server, slack, ana, 'U0ANA', 'billing')
    const off = server.requestWithSettings({ HB_SLACK_BOT_TOKEN: '', HB_SLACK_SIGNING_SECRET: '' })
    expect((await off('DELETE', '/api/v1/channels/billing/slack', { cookie: ana.cookie })).status).toBe(200)
    expect(await storedRows(server, 'slack_channel_links')).toEqual([])
    expect((await ana.api('GET', '/channels/billing')).json.link).toBeNull()
    expect(JSON.parse(String((await auditOf('slack.channel.unlinked'))[0]!.detail))).toEqual({
      slackChannel: 'C0HELP',
    })
    expect((await ana.api('DELETE', '/channels/billing/slack')).status).toBe(200)
  })

  it('removes the link when the channel is archived, and records why', async () => {
    await linkChannel(server, slack, ana, 'U0ANA', 'billing')
    expect((await ana.api('POST', '/admin/channels/billing/archive', {})).status).toBe(200)
    expect(await storedRows(server, 'slack_channel_links')).toEqual([])
    expect(JSON.parse(String((await auditOf('slack.channel.unlinked'))[0]!.detail))).toEqual({
      slackChannel: 'C0HELP',
      because: 'channel_archived',
    })
  })

  it('stops the link when the app leaves the Slack channel, or it is archived or deleted', async () => {
    for (const [event, because] of [
      [{ type: 'member_left_channel', user: BOT_USER_ID, channel: 'C0HELP' }, 'app_removed'],
      [{ type: 'channel_archive', channel: 'C0HELP' }, 'archived'],
      [{ type: 'channel_deleted', channel: 'C0HELP' }, 'deleted'],
    ] as const) {
      await ana.api('DELETE', '/channels/billing/slack')
      await linkChannel(server, slack, ana, 'U0ANA', 'billing')
      await sendSlackEvent(
        server,
        slackEvent({ type: 'member_left_channel', user: 'U0BEN', channel: 'C0HELP' }),
      )
      await sendSlackEvent(server, slackEvent({ ...event, channel: 'C0OTHER' }))
      await sendSlackEvent(server, slackEvent(event))
      await server.slackPass()
      expect((await storedRows(server, 'slack_channel_links'))[0]).toMatchObject({
        state: 'stopped',
        stopped_because: because,
      })
      expect((await ana.api('GET', '/channels/billing')).json.link.state).toBe('stopped')
    }
    expect(await auditOf('slack.channel.stopped')).toHaveLength(3)
  })

  it('offers a person not linked yet their own link first, and says a linked channel is linked', async () => {
    await sendSlackEvent(
      server,
      slackEvent({ type: 'app_mention', user: 'U0BEN', text: 'link', channel: 'C0HELP', ts: '9.3' }),
    )
    await server.slackPass()
    const offer = slack.calls.filter((call) => call.method === 'chat.postEphemeral').at(-1)!
    expect(offer.fields.text).toContain('To link your Slack user to Homingbird')
    expect((await ben.api('GET', `/slack/codes/${lastCodeIn(slack)}`)).json.kind).toBe('person')
  })
})

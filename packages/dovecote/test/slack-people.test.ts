import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, storedRows } from './harness.ts'
import { type FakeSlack, connectWorkspace, fakeSlack, startSlackServer } from './slack-support.ts'

let server: TestServer
let slack: FakeSlack
let ana: Session
let ben: Session

/** Ana signs in first, so she is the administrator. */

const USERS = [
  { id: 'U0ANA', name: 'Ana Silva', email: 'ana@example.com' },
  { id: 'U0BEN', name: 'Ben', email: 'ben@example.com' },
  { id: 'U0GUEST', name: 'Gus', email: 'gus@example.com', guest: true as const },
]

beforeEach(async () => {
  slack = fakeSlack(USERS)
  server = await startSlackServer(slack)
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server?.close())

/** The code in the link the app last sent in Slack. */
const lastCode = (): string => {
  const sent = [...slack.calls].reverse().find((call) => /chat\.post/.test(call.method))!
  return /#\/slack\/link\/([A-Za-z0-9_-]+)/.exec(sent.fields.text!)![1]!
}

describe('linking a person to their Slack user', () => {
  it('sends the Slack user with the person’s email a direct message with a link only that person can confirm', async () => {
    expect((await ana.api('GET', '/me/slack')).json).toEqual({
      team: 'Acme',
      connected: true,
      stopped: null,
      link: null,
    })
    expect((await ana.api('POST', '/me/slack/connect', {})).json).toEqual({ sent: true })
    const [message] = slack.posted()
    expect(message!.channel).toBe('DU0ANA')
    expect(message!.text).toContain('ana@example.com')
    const code = lastCode()
    expect((await ben.api('GET', `/slack/codes/${code}`)).status).toBe(404)
    expect((await ben.api('POST', '/me/slack/link', { code })).status).toBe(404)
    expect((await ana.api('GET', `/slack/codes/${code}`)).json).toMatchObject({
      kind: 'person',
      slackName: 'Ana Silva',
      team: 'Acme',
    })
    const linked = await ana.api('POST', '/me/slack/link', { code })
    expect(linked.json).toMatchObject({ connected: true, link: { slackName: 'Ana Silva' } })
    expect((await ana.api('POST', '/me/slack/link', { code })).status).toBe(404)
    const audit = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'slack.person.linked',
    )
    expect(audit).toHaveLength(1)
  })

  it('keeps a link code only as its hash', async () => {
    await ana.api('POST', '/me/slack/connect', {})
    const code = lastCode()
    const stored = JSON.stringify(await storedRows(server, 'slack_codes'))
    expect(stored).not.toContain(code)
  })

  it('says nothing was sent when no full member of the workspace has the email', async () => {
    const cy = await server.signIn('cy@example.com', 'Cy')
    expect((await cy.api('POST', '/me/slack/connect', {})).json).toEqual({ sent: false })
    const gus = await server.signIn('gus@example.com', 'Gus')
    expect((await gus.api('POST', '/me/slack/connect', {})).json).toEqual({ sent: false })
    expect(slack.posted()).toEqual([])
  })

  it('asks a person to wait a minute between requests, and refuses one already linked', async () => {
    await ana.api('POST', '/me/slack/connect', {})
    expect((await ana.api('POST', '/me/slack/connect', {})).status).toBe(409)
    await server.clock.advance(61_000)
    const code = lastCode()
    await ana.api('POST', '/me/slack/link', { code })
    expect((await ana.api('POST', '/me/slack/connect', {})).status).toBe(409)
  })

  it('refuses a code after ten minutes', async () => {
    await ana.api('POST', '/me/slack/connect', {})
    const code = lastCode()
    await server.clock.advance(10 * 60_000 + 1)
    expect((await ana.api('POST', '/me/slack/link', { code })).status).toBe(404)
  })

  it('links one Slack user to one person only', async () => {
    await ana.api('POST', '/me/slack/connect', {})
    const first = lastCode()
    await server.clock.advance(61_000)
    slack.users.set('U0BEN', { id: 'U0BEN', name: 'Ben', email: 'ana@example.com' })
    slack.users.delete('U0ANA')
    await ana.api('POST', '/me/slack/connect', {})
    const second = lastCode()
    expect((await ana.api('POST', '/me/slack/link', { code: first })).status).toBe(200)
    expect((await ana.api('POST', '/me/slack/link', { code: second })).status).toBe(409)
    await ana.api('DELETE', '/me/slack')
    slack.users.set('U0BEN', { id: 'U0BEN', name: 'Ben', email: 'ben@example.com' })
    await server.clock.advance(61_000)
    await ben.api('POST', '/me/slack/connect', {})
    await ben.api('POST', '/me/slack/link', { code: lastCode() })
    expect((await ana.api('POST', '/me/slack/link', { code: second })).status).toBe(409)
  })

  it('unlinks with Slack off, and records it', async () => {
    await ana.api('POST', '/me/slack/connect', {})
    await ana.api('POST', '/me/slack/link', { code: lastCode() })
    const off = server.requestWithSettings({ HB_SLACK_BOT_TOKEN: '', HB_SLACK_SIGNING_SECRET: '' })
    const unlinked = await off('DELETE', '/api/v1/me/slack', { cookie: ana.cookie })
    expect(unlinked.status).toBe(200)
    expect(await storedRows(server, 'slack_people')).toEqual([])
    expect((await off('GET', '/api/v1/me/slack', { cookie: ana.cookie })).status).toBe(404)
    const audit = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'slack.person.unlinked',
    )
    expect(audit).toHaveLength(1)
  })

  it('refuses to start or confirm a link while the workspace is stopped', async () => {
    await ana.api('POST', '/me/slack/connect', {})
    const code = lastCode()
    slack.refuseNext('auth.test', 'invalid_auth')
    await connectWorkspace(server)
    expect((await ana.api('GET', '/me/slack')).json).toMatchObject({ connected: false })
    expect((await ana.api('POST', '/me/slack/link', { code })).status).toBe(409)
    expect((await ben.api('POST', '/me/slack/connect', {})).status).toBe(409)
  })

  it('stops Slack when a call says the token no longer works, and sends nothing', async () => {
    slack.refuseNext('users.lookupByEmail', 'token_revoked')
    expect((await ana.api('POST', '/me/slack/connect', {})).json).toEqual({ sent: false })
    expect((await storedRows(server, 'slack_workspaces'))[0]).toMatchObject({ state: 'stopped' })
  })

  it('says nothing was sent when Slack refuses to open the direct message or to post it', async () => {
    slack.refuseNext('conversations.open', 'cannot_dm_bot')
    expect((await ana.api('POST', '/me/slack/connect', {})).json).toEqual({ sent: false })
    await server.clock.advance(61_000)
    slack.refuseNext('chat.postMessage', 'msg_too_long')
    expect((await ana.api('POST', '/me/slack/connect', {})).json).toEqual({ sent: false })
  })

  it('deletes a person’s link when they are deactivated, and records why', async () => {
    await ben.api('POST', '/me/slack/connect', {})
    await ben.api('POST', '/me/slack/link', { code: lastCode() })
    const deactivated = await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, {
      status: 'deactivated',
    })
    expect(deactivated.status).toBe(200)
    expect(await storedRows(server, 'slack_people')).toEqual([])
    const [row] = (await storedRows(server, 'audit_events')).filter(
      (each) => each.event === 'slack.person.unlinked',
    )
    expect(JSON.parse(String(row!.detail))).toEqual({ because: 'deactivated' })
  })
})

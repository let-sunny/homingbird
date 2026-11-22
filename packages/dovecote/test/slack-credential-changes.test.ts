import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, TEST_SECRETS_KEY, type TestServer, startTestServer, storedRows } from './harness.ts'
import {
  type FakeSlack,
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  SLACK_VALUES,
  fakeSlack,
  sendSlackEvent,
  startSlackServer,
  startStoredSlackServer,
} from './slack-support.ts'

let server: TestServer
let slack: FakeSlack
let ana: Session
let ben: Session

beforeEach(async () => {
  slack = fakeSlack()
  server = await startStoredSlackServer(slack)
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server?.close())

const OTHER_TOKEN = 'xoxb-2222-3333-anothertokenvalue'

const auditOf = async (event: string) =>
  (await storedRows(server, 'audit_events')).filter((row) => row.event === event)

describe('an administrator giving the Slack app’s values in the web client', () => {
  it('offers Slack on a server with a key but no app values, and waits for them', async () => {
    expect((await server.request('GET', '/api/v1/info')).json.features.slack).toBe(true)
    const admin = (await ana.api('GET', '/admin/slack')).json
    expect(admin.workspace).toBeNull()
    expect(admin.credentials).toEqual({ source: 'none', canStore: true, storedAt: null })
    expect((await ana.api('GET', '/me/slack')).json.connected).toBe(false)
    expect((await sendSlackEvent(server, { type: 'url_verification', challenge: 'c' })).status).toBe(404)
  })

  it('checks the token with Slack, keeps the values and connects the workspace, answering without them', async () => {
    const answer = await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    expect(answer.status).toBe(200)
    expect(slack.calls.map((call) => call.method)).toEqual(['auth.test'])
    expect(slack.tokens).toEqual([SLACK_BOT_TOKEN])
    expect(answer.json.credentials).toEqual({
      source: 'stored',
      canStore: true,
      storedAt: server.env.clock.now(),
    })
    expect(answer.json.workspace).toMatchObject({ team: 'Acme', state: 'connected' })
    expect(JSON.stringify(answer.json)).not.toContain(SLACK_BOT_TOKEN)
    expect(JSON.stringify(answer.json)).not.toContain(SLACK_SIGNING_SECRET)
    expect((await ana.api('GET', '/me/slack')).json.connected).toBe(true)
    const verified = await sendSlackEvent(server, { type: 'url_verification', challenge: 'c' })
    expect(verified.json).toEqual({ challenge: 'c' })
    expect((await auditOf('slack.credentials_set')).map((row) => JSON.parse(String(row.detail)))).toEqual([
      {},
    ])
    expect(await auditOf('slack.connected')).toHaveLength(1)
  })

  it('refuses events signed with any other secret than the one given', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    const forged = await sendSlackEvent(
      server,
      { type: 'url_verification', challenge: 'c' },
      { secret: 'ffffffffffffffffffffffffffffffff' },
    )
    expect(forged.status).toBe(401)
  })

  it('replaces the values given before, and calls Slack with the new token from then on', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    const replaced = await ana.api('PUT', '/admin/slack/credentials', {
      botToken: OTHER_TOKEN,
      signingSecret: 'abcdefabcdefabcdef',
    })
    expect(replaced.status).toBe(200)
    expect(await storedRows(server, 'slack_credentials')).toHaveLength(1)
    await server.clock.advance(61_000)
    await ana.api('POST', '/me/slack/connect', {})
    expect(slack.tokens.slice(1).every((token) => token === OTHER_TOKEN)).toBe(true)
    expect(slack.tokens.length).toBeGreaterThan(2)
    expect((await sendSlackEvent(server, { type: 'url_verification', challenge: 'c' })).status).toBe(401)
    expect(await auditOf('slack.credentials_set')).toHaveLength(2)
  })

  it('keeps nothing when Slack refuses the token or cannot be reached, and says so without the token', async () => {
    slack.refuseNext('auth.test', 'invalid_auth')
    const refused = await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    expect(refused.status).toBe(400)
    expect(refused.json.error.message).toBe('Slack refused the bot token (invalid_auth).')
    slack.answerNextWith('auth.test', 500)
    const unreachable = await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    expect(unreachable.status).toBe(400)
    expect(unreachable.json.error.message).toContain('could not be reached')
    for (const answer of [refused, unreachable])
      expect(JSON.stringify(answer.json)).not.toContain(SLACK_BOT_TOKEN)
    expect(await storedRows(server, 'slack_credentials')).toEqual([])
    expect(await storedRows(server, 'slack_workspaces')).toEqual([])
    expect(await auditOf('slack.credentials_set')).toEqual([])
  })

  it('refuses a token of another workspace than the one this server answers', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    slack.moveTokenTo('T0OTHER')
    const refused = await ana.api('PUT', '/admin/slack/credentials', {
      ...SLACK_VALUES,
      botToken: OTHER_TOKEN,
    })
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toBe(
      'This bot token belongs to another Slack workspace. This server answers only Acme.',
    )
    const [row] = await storedRows(server, 'slack_workspaces')
    expect(row!.state).toBe('connected')
  })

  it('refuses malformed values without repeating them', async () => {
    const malformed = await ana.api('PUT', '/admin/slack/credentials', {
      botToken: 'xoxp-1234-5678-usertokenvalue',
      signingSecret: 'not-hex-secret-value',
    })
    expect(malformed.status).toBe(400)
    expect(JSON.stringify(malformed.json)).not.toContain('usertokenvalue')
    expect(JSON.stringify(malformed.json)).not.toContain('not-hex-secret-value')
    expect(slack.calls).toEqual([])
  })

  it('lets only an administrator give or remove the values', async () => {
    expect((await ben.api('PUT', '/admin/slack/credentials', SLACK_VALUES)).status).toBe(403)
    expect((await ben.api('DELETE', '/admin/slack/credentials')).status).toBe(403)
    expect(slack.calls).toEqual([])
  })

  it('deletes the values on removal, so Slack stops, and says when nothing is stored', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    const removed = await ana.api('DELETE', '/admin/slack/credentials')
    expect(removed.status).toBe(200)
    expect(removed.json.credentials).toEqual({ source: 'none', canStore: true, storedAt: null })
    expect(await storedRows(server, 'slack_credentials')).toEqual([])
    expect((await ana.api('GET', '/me/slack')).json.connected).toBe(false)
    expect((await sendSlackEvent(server, { type: 'url_verification', challenge: 'c' })).status).toBe(404)
    expect((await auditOf('slack.credentials_removed')).map((row) => JSON.parse(String(row.detail)))).toEqual(
      [{}],
    )
    const again = await ana.api('DELETE', '/admin/slack/credentials')
    expect(again.status).toBe(404)
    expect(await auditOf('slack.credentials_removed')).toHaveLength(1)
  })

  it('refuses to keep values while the server’s environment has its own, which win', async () => {
    await server.close()
    slack = fakeSlack()
    server = await startSlackServer(slack, { HB_SECRETS_KEY: TEST_SECRETS_KEY })
    ana = await server.signIn('ana@example.com', 'Ana')
    expect((await ana.api('GET', '/admin/slack')).json.credentials).toEqual({
      source: 'environment',
      canStore: true,
      storedAt: null,
    })
    const refused = await ana.api('PUT', '/admin/slack/credentials', {
      ...SLACK_VALUES,
      botToken: OTHER_TOKEN,
    })
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toContain('HB_SLACK_BOT_TOKEN')
    expect(await storedRows(server, 'slack_credentials')).toEqual([])
    expect(slack.tokens).not.toContain(OTHER_TOKEN)
  })

  it('refuses to keep values on a server without a key, where Slack is offered only through the environment', async () => {
    await server.close()
    slack = fakeSlack()
    server = await startSlackServer(slack)
    ana = await server.signIn('ana@example.com', 'Ana')
    expect((await ana.api('GET', '/admin/slack')).json.credentials.canStore).toBe(false)
    await server.close()
    server = await startTestServer({ HB_FEATURES: 'slack=on' }, { fetch: slack.fetch })
    expect((await server.request('GET', '/api/v1/info')).json.features.slack).toBe(false)
  })
})

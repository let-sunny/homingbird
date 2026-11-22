import { afterEach, describe, expect, it } from 'vitest'
import { type TestServer, startTestServer, storedRows } from './harness.ts'
import {
  type FakeSlack,
  SLACK_VARIABLES,
  fakeSlack,
  sendSlackEvent,
  slackEvent,
  startSlackServer,
} from './slack-support.ts'

let server: TestServer | undefined
let slack: FakeSlack

afterEach(async () => {
  await server?.close()
  server = undefined
})

const started = async () => {
  slack = fakeSlack([{ id: 'U0ANA', name: 'Ana Silva', email: 'ana@example.com' }])
  server = await startSlackServer(slack)
  return server
}

const SECRET_TEXT = 'channel-only secret 51c2'

describe('the Slack events address', () => {
  it('answers 404 while Slack is off or the server has no Slack app', async () => {
    server = await startTestServer({ ...SLACK_VARIABLES, HB_FEATURES: 'slack=off' })
    expect((await sendSlackEvent(server, { type: 'url_verification', challenge: 'c' })).status).toBe(404)
    await server.close()
    server = await startTestServer({ HB_FEATURES: 'slack=on' })
    expect((await server.request('POST', '/slack/events', { body: {} })).status).toBe(404)
  })

  it('answers Slack’s address check with its challenge, only when signed', async () => {
    const running = await started()
    const answer = await sendSlackEvent(running, { type: 'url_verification', challenge: 'chal-123' })
    expect(answer.status).toBe(200)
    expect(answer.json).toEqual({ challenge: 'chal-123' })
    const unsigned = await running.request('POST', '/slack/events', {
      body: { type: 'url_verification', challenge: 'chal-123' },
    })
    expect(unsigned.status).toBe(401)
    expect((await running.request('GET', '/slack/events')).status).toBe(405)
  })

  it('refuses a request signed with another secret or more than five minutes ago, and logs only why', async () => {
    const running = await started()
    const payload = slackEvent({
      type: 'app_mention',
      user: 'U0ANA',
      text: SECRET_TEXT,
      channel: 'C1',
      ts: '1.0',
    })
    expect((await sendSlackEvent(running, payload, { secret: 'f'.repeat(32) })).status).toBe(401)
    const old = running.env.clock.now() - 5 * 60_000 - 1000
    expect((await sendSlackEvent(running, payload, { signedAt: old })).status).toBe(401)
    expect(await storedRows(running, 'slack_events')).toEqual([])
    const logged = running.logged.join('\n')
    expect(logged).toContain('signature_mismatch')
    expect(logged).toContain('signature_stale')
    expect(logged).not.toContain(SECRET_TEXT)
  })

  it('refuses a signed body that is not a Slack event', async () => {
    const running = await started()
    expect((await sendSlackEvent(running, { nothing: true })).status).toBe(400)
    expect(running.logged.join('\n')).toContain('malformed')
  })

  it('keeps a mention once, whatever Slack retries, and notes when it last heard from Slack', async () => {
    const running = await started()
    const payload = slackEvent({
      type: 'app_mention',
      user: 'U0ANA',
      text: '<@U0BOT> link',
      channel: 'C1',
      ts: '1.0',
    })
    expect((await sendSlackEvent(running, payload)).status).toBe(200)
    expect((await sendSlackEvent(running, payload)).status).toBe(200)
    const kept = await storedRows(running, 'slack_events')
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ event_id: payload.event_id, kind: 'app_mention', processed_at: null })
    expect((await storedRows(running, 'slack_workspaces'))[0]!.last_event_at).not.toBeNull()
  })

  it('drops a channel message unread: never stored and never logged', async () => {
    const running = await started()
    const message = slackEvent({
      type: 'message',
      channel_type: 'channel',
      user: 'U0ANA',
      text: SECRET_TEXT,
      channel: 'C1',
      ts: '2.0',
    })
    expect((await sendSlackEvent(running, message)).status).toBe(200)
    expect(await storedRows(running, 'slack_events')).toEqual([])
    expect(running.logged.join('\n')).not.toContain(SECRET_TEXT)
  })

  it('drops an event of another workspace, an event without its id, and one before a workspace is pinned', async () => {
    const running = await started()
    const mention = { type: 'app_mention', user: 'U0ANA', text: 'link', channel: 'C1', ts: '1.0' }
    await sendSlackEvent(running, slackEvent(mention, 'T0OTHER'))
    const { event_id: _, ...withoutId } = slackEvent(mention)
    await sendSlackEvent(running, withoutId)
    await sendSlackEvent(running, { type: 'event_callback', team_id: 'T0ACME', event_id: 'Ev-x' })
    await sendSlackEvent(running, slackEvent({ type: 'app_mention', channel: 'C1' }))
    await sendSlackEvent(running, { type: 'block_actions' })
    expect(await storedRows(running, 'slack_events')).toEqual([])
    await running.close()
    server = await startTestServer(SLACK_VARIABLES, { fetch: fakeSlack().fetch })
    await sendSlackEvent(server, slackEvent(mention))
    expect(await storedRows(server, 'slack_events')).toEqual([])
  })

  it('keeps a profile change of a linked person only, and nothing of it but the id, name and whether they left', async () => {
    const running = await started()
    const change = (id: string) =>
      slackEvent({
        type: 'user_change',
        user: {
          id,
          name: 'ana',
          real_name: 'Ana S',
          deleted: false,
          profile: { email: 'ana@example.com', phone: '555' },
        },
      })
    await sendSlackEvent(running, change('U0ANA'))
    expect(await storedRows(running, 'slack_events')).toEqual([])
    const ana = await running.signIn('ana@example.com', 'Ana')
    await ana.api('POST', '/me/slack/connect', {})
    const code = /#\/slack\/link\/([A-Za-z0-9_-]+)/.exec(slack.posted()[0]!.text!)![1]!
    await ana.api('POST', '/me/slack/link', { code })
    await sendSlackEvent(running, change('U0ANA'))
    await sendSlackEvent(running, slackEvent({ type: 'user_change', user: { name: 'no id' } }))
    const [kept] = await storedRows(running, 'slack_events')
    expect(JSON.parse(String(kept!.payload))).toEqual({
      type: 'user_change',
      subject: { id: 'U0ANA', name: 'Ana S', deleted: false },
    })
  })

  it('keeps an uninstall and a revocation', async () => {
    const running = await started()
    await sendSlackEvent(running, slackEvent({ type: 'app_uninstalled' }))
    await sendSlackEvent(
      running,
      slackEvent({ type: 'tokens_revoked', tokens: { oauth: ['U1'], bot: ['U0BOT'] } }),
    )
    await sendSlackEvent(running, slackEvent({ type: 'tokens_revoked', tokens: { oauth: ['U1'] } }))
    await sendSlackEvent(running, slackEvent({ type: 'tokens_revoked' }))
    expect((await storedRows(running, 'slack_events')).map((row) => row.kind).sort()).toEqual([
      'app_uninstalled',
      'tokens_revoked',
      'tokens_revoked',
    ])
  })
})

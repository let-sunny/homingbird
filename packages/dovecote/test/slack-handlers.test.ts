import { afterEach, describe, expect, it } from 'vitest'
import { type TestServer, startTestServer } from './harness.ts'
import {
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  SLACK_VARIABLES,
  fakeSlack,
  startSlackServer,
} from './slack-support.ts'

let server: TestServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('Slack for an administrator', () => {
  it('shows the workspace, the events address and the manifest, and never the token or the secret', async () => {
    server = await startSlackServer(fakeSlack())
    const admin = await server.signIn('ana@example.com', 'Ana')
    const read = await admin.api('GET', '/admin/slack')
    expect(read.json).toMatchObject({
      workspace: { team: 'Acme', state: 'connected', stoppedBecause: null, lastEventAt: null },
      eventsUrl: 'http://localhost:8080/slack/events',
      linkedPeople: 0,
    })
    expect(JSON.parse(read.json.manifest).settings.event_subscriptions.request_url).toBe(
      'http://localhost:8080/slack/events',
    )
    expect(JSON.stringify(read.json)).not.toContain(SLACK_BOT_TOKEN)
    expect(JSON.stringify(read.json)).not.toContain(SLACK_SIGNING_SECRET)
    const member = await server.signIn('ben@example.com', 'Ben')
    expect((await member.api('GET', '/admin/slack')).status).toBe(403)
  })

  it('says no workspace is connected before the first check', async () => {
    server = await startTestServer(SLACK_VARIABLES, { fetch: fakeSlack().fetch })
    const admin = await server.signIn('ana@example.com', 'Ana')
    expect((await admin.api('GET', '/admin/slack')).json).toMatchObject({ workspace: null })
    expect((await admin.api('GET', '/me/slack')).json).toEqual({ team: null, connected: false, link: null })
  })

  it('offers Slack only when the server has its app, and answers 404 on its routes otherwise', async () => {
    server = await startTestServer({ HB_FEATURES: 'slack=on' })
    const admin = await server.signIn('ana@example.com', 'Ana')
    expect((await server.request('GET', '/api/v1/info')).json.features.slack).toBe(false)
    expect((await admin.api('GET', '/admin/slack')).status).toBe(404)
    expect((await admin.api('GET', '/me/slack')).status).toBe(404)
    expect((await admin.api('DELETE', '/me/slack')).status).toBe(200)
  })
})

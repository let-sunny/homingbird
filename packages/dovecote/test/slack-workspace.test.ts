import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { transact } from '../src/events/events.ts'
import { slackTokenRefused, stopSlack, workingSlack } from '../src/slack/slack-workspace.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'
import { SLACK_VARIABLES, TEAM_ID, connectWorkspace, fakeSlack, startSlackServer } from './slack-support.ts'

let server: TestServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

const auditOf = async (running: TestServer, event: string) =>
  (await storedRows(running, 'audit_events')).filter((row) => row.event === event)

describe('the Slack workspace', () => {
  it('pins the workspace the bot token belongs to at the first check, and records it', async () => {
    server = await startSlackServer(fakeSlack())
    const [workspace] = await storedRows(server, 'slack_workspaces')
    expect(workspace).toMatchObject({
      team_id: TEAM_ID,
      team_name: 'Acme',
      bot_user_id: 'U0BOT',
      bot_id: 'B0BOT',
      state: 'connected',
    })
    expect(await auditOf(server, 'slack.connected')).toHaveLength(1)
    await connectWorkspace(server)
    expect(await auditOf(server, 'slack.connected')).toHaveLength(1)
    expect(await T.runPromise(workingSlack, server.env)).not.toBeNull()
  })

  it('stops when the token belongs to another workspace, and keeps the pinned one', async () => {
    const slack = fakeSlack()
    server = await startSlackServer(slack)
    slack.moveTokenTo('T0OTHER')
    await connectWorkspace(server)
    const [workspace] = await storedRows(server, 'slack_workspaces')
    expect(workspace).toMatchObject({
      team_id: TEAM_ID,
      state: 'stopped',
      stopped_because: 'other_workspace',
    })
    expect(await auditOf(server, 'slack.stopped')).toHaveLength(1)
    expect(await T.runPromise(workingSlack, server.env)).toBeNull()
  })

  it('stops when Slack refuses the token, and connects again once a check succeeds', async () => {
    const slack = fakeSlack()
    server = await startSlackServer(slack)
    slack.refuseNext('auth.test', 'invalid_auth')
    await connectWorkspace(server)
    expect((await storedRows(server, 'slack_workspaces'))[0]).toMatchObject({
      state: 'stopped',
      stopped_because: 'token_refused',
    })
    expect(server.logged.some((line) => line.includes('slack.call_failed'))).toBe(true)
    expect(server.logged.join('\n')).not.toContain('botsecretvalue')
    await connectWorkspace(server)
    expect((await storedRows(server, 'slack_workspaces'))[0]).toMatchObject({
      state: 'connected',
      stopped_because: null,
    })
    expect(await auditOf(server, 'slack.connected')).toHaveLength(2)
  })

  it('remembers that Slack refused the token before any workspace was pinned, and forgets it once one works', async () => {
    const slack = fakeSlack()
    slack.refuseNext('auth.test', 'invalid_auth')
    server = await startSlackServer(slack)
    expect(await storedRows(server, 'slack_workspaces')).toEqual([])
    expect(await T.runPromise(slackTokenRefused, server.env)).toBe(true)
    const admin = await server.signIn('ana@example.com', 'Ana')
    expect((await admin.api('GET', '/admin/slack')).json).toMatchObject({
      workspace: null,
      tokenRefused: true,
    })
    expect((await admin.api('GET', '/me/slack')).json).toMatchObject({
      connected: false,
      stopped: 'token_refused',
    })
    await connectWorkspace(server)
    expect(await T.runPromise(slackTokenRefused, server.env)).toBe(false)
    expect((await admin.api('GET', '/admin/slack')).json).toMatchObject({ tokenRefused: false })
    expect((await admin.api('GET', '/me/slack')).json).toMatchObject({ connected: true, stopped: null })
  })

  it('tells a person why Slack stopped once a pinned workspace stops', async () => {
    const slack = fakeSlack()
    server = await startSlackServer(slack)
    slack.refuseNext('auth.test', 'invalid_auth')
    await connectWorkspace(server)
    const person = await server.signIn('ana@example.com', 'Ana')
    expect((await person.api('GET', '/me/slack')).json).toMatchObject({
      team: 'Acme',
      connected: false,
      stopped: 'token_refused',
    })
  })

  it('leaves the state as it was when Slack cannot be reached or refuses for another reason', async () => {
    const slack = fakeSlack()
    server = await startSlackServer(slack)
    slack.refuseNext('auth.test', 'fatal_error')
    await connectWorkspace(server)
    expect((await storedRows(server, 'slack_workspaces'))[0]).toMatchObject({ state: 'connected' })
  })

  it('records a stop once, and does nothing before a workspace is pinned', async () => {
    server = await startTestServer(SLACK_VARIABLES, { fetch: fakeSlack().fetch })
    await T.runPromise(transact(stopSlack('revoked')), server.env)
    expect(await storedRows(server, 'slack_workspaces')).toEqual([])
    await connectWorkspace(server)
    await T.runPromise(transact(stopSlack('revoked')), server.env)
    await T.runPromise(transact(stopSlack('revoked')), server.env)
    expect(await auditOf(server, 'slack.stopped')).toHaveLength(1)
  })

  it('checks nothing and works nowhere while the feature is off or the server has no Slack app', async () => {
    const slack = fakeSlack()
    server = await startTestServer({ ...SLACK_VARIABLES, HB_FEATURES: 'slack=off' }, { fetch: slack.fetch })
    await connectWorkspace(server)
    expect(slack.calls).toEqual([])
    await server.close()
    server = await startTestServer({ HB_FEATURES: 'slack=on' }, { fetch: slack.fetch })
    await connectWorkspace(server)
    expect(slack.calls).toEqual([])
    expect(await T.runPromise(workingSlack, server.env)).toBeNull()
  })
})

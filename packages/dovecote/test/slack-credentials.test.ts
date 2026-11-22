import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { transact } from '../src/events/events.ts'
import { slackCredentials, slackCredentialsView } from '../src/slack/slack-credentials.ts'
import { stopSlack } from '../src/slack/slack-workspace.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { type Session, TEST_SECRETS_KEY, type TestServer, storedRows } from './harness.ts'
import {
  type FakeSlack,
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  SLACK_VALUES,
  SLACK_VARIABLES,
  fakeSlack,
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

const credentials = () => T.runPromise(slackCredentials, server.env)

const auditOf = async (event: string) =>
  (await storedRows(server, 'audit_events')).filter((row) => row.event === event)

/** Ben is made an administrator and gives the Slack app's values. */
const benGivesValues = async () => {
  await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { role: 'admin' })
  expect((await ben.api('PUT', '/admin/slack/credentials', SLACK_VALUES)).status).toBe(200)
}

describe('the Slack app’s values', () => {
  it('opens the values an active administrator gave, and says only where they come from and when', async () => {
    expect(await credentials()).toBeNull()
    expect(await T.runPromise(slackCredentialsView, server.env)).toEqual({
      source: 'none',
      canStore: true,
      storedAt: null,
    })
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    const now = server.env.clock.now()
    expect(await credentials()).toEqual({
      botToken: SLACK_BOT_TOKEN,
      signingSecret: SLACK_SIGNING_SECRET,
      source: 'stored',
      storedAt: now,
    })
    expect(await T.runPromise(slackCredentialsView, server.env)).toEqual({
      source: 'stored',
      canStore: true,
      storedAt: now,
    })
  })

  it('takes the values in the server’s environment over stored ones', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    const environment = { ...SLACK_VARIABLES, HB_SLACK_BOT_TOKEN: 'xoxb-9999-8888-fromenvironment' }
    const env = { ...server.env, config: { ...server.env.config, ...configWith(environment) } }
    expect(await T.runPromise(slackCredentials, env)).toEqual({
      botToken: 'xoxb-9999-8888-fromenvironment',
      signingSecret: SLACK_SIGNING_SECRET,
      source: 'environment',
      storedAt: null,
    })
  })

  it('says a server without a key cannot keep values, and opens none without it', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    const keyless = { ...server.env, config: { ...server.env.config, secretsKey: null } }
    expect(await T.runPromise(slackCredentials, keyless)).toBeNull()
    expect(await T.runPromise(slackCredentialsView, keyless)).toEqual({
      source: 'none',
      canStore: false,
      storedAt: null,
    })
  })

  it('opens no value moved to another owner, swapped with the other, or sealed with another key', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    const [row] = await storedRows(server, 'slack_credentials')
    await T.runPromise(run(sql`UPDATE members SET role = 'admin' WHERE id = ${ben.me.member.id}`), server.env)
    await T.runPromise(run(sql`UPDATE slack_credentials SET given_by = ${ben.me.member.id}`), server.env)
    expect(await credentials()).toBeNull()
    await restoreRow(row!)
    expect(await credentials()).not.toBeNull()
    await T.runPromise(
      run(sql`UPDATE slack_credentials SET bot_token_sealed = ${row!.signing_secret_sealed},
        signing_secret_sealed = ${row!.bot_token_sealed}`),
      server.env,
    )
    expect(await credentials()).toBeNull()
    await restoreRow(row!)
    const otherKey = Buffer.alloc(32, 9)
    const env = { ...server.env, config: { ...server.env.config, secretsKey: otherKey } }
    expect(await T.runPromise(slackCredentials, env)).toBeNull()
  })

  it('uses no value whose giver stopped being an active administrator by any way, even before it is deleted', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    await T.runPromise(
      run(sql`UPDATE members SET role = 'member' WHERE id = ${ana.me.member.id}`),
      server.env,
    )
    expect(await credentials()).toBeNull()
    await T.runPromise(
      run(sql`UPDATE members SET role = 'admin', status = 'deactivated' WHERE id = ${ana.me.member.id}`),
      server.env,
    )
    expect(await credentials()).toBeNull()
  })

  it('deletes the values a member gave when they are deactivated, and records why', async () => {
    await benGivesValues()
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })
    expect(await storedRows(server, 'slack_credentials')).toEqual([])
    const [removed] = await auditOf('slack.credentials_removed')
    expect(JSON.parse(String(removed!.detail))).toEqual({ because: 'deactivated' })
    expect(removed!.actor_id).toBe(ana.me.member.id)
  })

  it('deletes the values a member gave when they stop being an administrator, and records why', async () => {
    await benGivesValues()
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { role: 'member' })
    expect(await storedRows(server, 'slack_credentials')).toEqual([])
    const [removed] = await auditOf('slack.credentials_removed')
    expect(JSON.parse(String(removed!.detail))).toEqual({ because: 'demoted' })
  })

  it('keeps the values when someone else is deactivated or demoted, or the giver stays an administrator', async () => {
    const cy = await server.signIn('cy@example.com', 'Cy')
    await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { role: 'admin' })
    await benGivesValues()
    await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { role: 'member' })
    await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { status: 'deactivated' })
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { role: 'admin' })
    expect(await storedRows(server, 'slack_credentials')).toHaveLength(1)
    expect(await auditOf('slack.credentials_removed')).toEqual([])
  })

  it('deletes stored values when Slack revokes the token or the app is uninstalled', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    await T.runPromise(transact(stopSlack('revoked')), server.env)
    expect(await storedRows(server, 'slack_credentials')).toEqual([])
    const [removed] = await auditOf('slack.credentials_removed')
    expect(JSON.parse(String(removed!.detail))).toEqual({ because: 'revoked' })
  })

  it('keeps stored values when Slack refuses the token for another reason, or the token is the environment’s', async () => {
    await ana.api('PUT', '/admin/slack/credentials', SLACK_VALUES)
    await T.runPromise(transact(stopSlack('token_refused')), server.env)
    expect(await storedRows(server, 'slack_credentials')).toHaveLength(1)
    await server.close()
    slack = fakeSlack()
    server = await startSlackServer(slack, { HB_SECRETS_KEY: TEST_SECRETS_KEY })
    ana = await server.signIn('ana@example.com', 'Ana')
    await T.runPromise(
      run(sql`INSERT INTO slack_credentials (slot, given_by, bot_token_sealed, signing_secret_sealed, given_at)
        VALUES ('app', ${ana.me.member.id}, 'v1.x', 'v1.y', 1)`),
      server.env,
    )
    await T.runPromise(transact(stopSlack('revoked')), server.env)
    expect(await storedRows(server, 'slack_credentials')).toHaveLength(1)
    expect(await auditOf('slack.credentials_removed')).toEqual([])
  })
})

const configWith = (variables: Readonly<Record<string, string>>) => ({
  slack: {
    botToken: variables.HB_SLACK_BOT_TOKEN!,
    signingSecret: variables.HB_SLACK_SIGNING_SECRET!,
  },
})

const restoreRow = (row: Readonly<Record<string, unknown>>) =>
  T.runPromise(
    run(sql`UPDATE slack_credentials SET given_by = ${String(row.given_by)},
      bot_token_sealed = ${String(row.bot_token_sealed)},
      signing_secret_sealed = ${String(row.signing_secret_sealed)}`),
    server.env,
  )

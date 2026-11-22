import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { leaverFactsFor } from '../src/domain/leaver-facts.ts'
import { run } from '../src/sql/database.ts'
import { insertInto } from '../src/sql/query.ts'
import { type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
afterEach(() => server.close())

const factsFor = (email: string) => T.runPromise(leaverFactsFor(email), server.env)

const DAY_MS = 24 * 60 * 60_000

describe('what the server still holds for a person who left', () => {
  it('finds what still works for a person before deactivation, and after it only what deactivation cannot reach', async () => {
    server = await startTestServer({ HB_ADMIN_EMAILS: 'root@example.com' })
    const root = await server.signIn('root@example.com')
    const ben = await server.signIn('ben@example.com')
    await connectAgent(server, ben)
    await root.api('POST', '/admin/groups', { name: 'Billing', memberIds: [ben.me.member.id] })
    await insert('credentials', {
      id: 'cred_channelagent',
      member_id: 'mem_channelagent',
      kind: 'agent',
      name: 'Channel agent',
      client: 'cli',
      token_hash: 'hash-for-a-channel-agent',
      token_expires_at: server.clock.now() + DAY_MS,
      expires_at: server.clock.now() + DAY_MS,
      created_at: server.clock.now(),
      issued_by: ben.me.member.id,
    })
    await insert('auth_requests', {
      id: 'req_waiting',
      kind: 'device',
      status: 'approved',
      member_id: ben.me.member.id,
      detail: '{}',
      created_at: server.clock.now(),
      expires_at: server.clock.now() + 60_000,
    })
    await insert('desk_wakes', {
      member_id: ben.me.member.id,
      credential_id: 'cred_wake',
      host: 'api.anthropic.com',
      sealed: 'sealed',
      enabled: 1,
      last_status: 'none',
      failures: 0,
      created_at: 1,
      updated_at: 1,
    })

    expect(await factsFor(' Ben@Example.com ')).toEqual({
      id: ben.me.member.id,
      email: 'ben@example.com',
      status: 'active',
      ownCredentials: 2,
      issuedCredentials: 1,
      groups: 1,
      approvedSignIns: 1,
      deskWakes: 1,
      namedAdministrator: false,
    })

    await root.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })

    expect(await factsFor('ben@example.com')).toEqual({
      id: ben.me.member.id,
      email: 'ben@example.com',
      status: 'deactivated',
      ownCredentials: 0,
      issuedCredentials: 1,
      groups: 0,
      approvedSignIns: 0,
      deskWakes: 0,
      namedAdministrator: false,
    })
  })

  it('counts neither an expired credential nor an expired sign-in, and says HB_ADMIN_EMAILS names them', async () => {
    server = await startTestServer({ HB_ADMIN_EMAILS: 'root@example.com' })
    await server.signIn('root@example.com')
    await insert('auth_requests', {
      id: 'req_old',
      kind: 'device',
      status: 'approved',
      member_id: (await factsFor('root@example.com'))!.id,
      detail: '{}',
      created_at: 1,
      expires_at: server.clock.now() + 60_000,
    })
    await server.clock.advance(400 * DAY_MS)
    expect(await factsFor('root@example.com')).toMatchObject({
      ownCredentials: 0,
      approvedSignIns: 0,
      namedAdministrator: true,
    })
  })

  it('knows nobody by an email no person has', async () => {
    server = await startTestServer()
    expect(await factsFor('nobody@example.com')).toBeNull()
  })
})

const insert = (table: string, row: Record<string, unknown>) =>
  T.runPromise(run(insertInto(table, row)), server.env)

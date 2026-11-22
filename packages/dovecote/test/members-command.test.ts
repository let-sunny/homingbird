import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { offboardingChecks, runMembersCommand } from '../src/members-command.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

const command = async (...args: string[]) => {
  const lines: string[] = []
  const code = await T.runPromise(
    runMembersCommand(args, (line) => lines.push(line)),
    server!.env,
  )
  return { code, lines }
}

describe('dovecote members verify-left', () => {
  it('fails each check a person who has not left yet fails, and passes them all once they are deactivated', async () => {
    server = await startTestServer({ HB_ADMIN_EMAILS: 'root@example.com' })
    const root = await server.signIn('root@example.com')
    const ben = await server.signIn('ben@example.com')
    const agent = await connectAgent(server, ben)
    await root.api('POST', '/admin/groups', { name: 'Billing', memberIds: [ben.me.member.id] })

    expect(await command('verify-left', 'ben@example.com')).toEqual({
      code: 1,
      lines: [
        `Offboarding checks for ben@example.com (${ben.me.member.id}):`,
        '  FAIL  Deactivated: the member is active',
        '  FAIL  No working credential of their own, browser or agent: 2 still work',
        "  pass  No working credential they issued to a channel's agent",
        '  FAIL  In no group, so managing no channel: 1 group',
        '  pass  No approved sign-in waiting for a program',
        '  pass  No cloud desk wake address',
        '  pass  Not named in HB_ADMIN_EMAILS',
        '3 of 7 checks fail.',
      ],
    })

    await root.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })
    const after = await command('verify-left', 'ben@example.com')
    expect(after.code).toBe(0)
    expect(after.lines.at(-1)).toBe('Every check passes.')
    expect(after.lines.filter((line) => line.startsWith('  pass'))).toHaveLength(7)
    expect(after.lines.join('\n')).not.toContain(agent.token)
    expect(after.lines.join('\n')).not.toContain(ben.token)
  })

  it('says nobody has an email no person has, and how to call it otherwise', async () => {
    server = await startTestServer()
    expect(await command('verify-left', 'gone@example.com')).toEqual({
      code: 1,
      lines: ['No person has the email gone@example.com.'],
    })
    for (const args of [[], ['verify-left'], ['verify'], ['verify-left', 'a@example.com', 'b@example.com']])
      expect(await command(...args)).toEqual({
        code: 2,
        lines: ['Usage: dovecote members verify-left <email>'],
      })
  })

  it('refuses a database of another version without changing it', async () => {
    server = await startTestServer()
    await T.runPromise(run(sql`DELETE FROM schema_versions WHERE version > 1`), server.env)
    const refused = await command('verify-left', 'ben@example.com')
    expect(refused.code).toBe(3)
  })
})

describe('the offboarding checks', () => {
  it('says what each failed check found, in the guide’s order', () => {
    const checks = offboardingChecks({
      id: 'mem_x' as never,
      email: 'x@example.com',
      status: 'active',
      ownCredentials: 1,
      issuedCredentials: 2,
      groups: 3,
      approvedSignIns: 1,
      deskWakes: 1,
      namedAdministrator: true,
    })
    expect(checks.map((check) => [check.passed, check.text])).toEqual([
      [false, 'Deactivated: the member is active'],
      [false, 'No working credential of their own, browser or agent: 1 still works'],
      [false, "No working credential they issued to a channel's agent: 2 still work"],
      [false, 'In no group, so managing no channel: 3 groups'],
      [false, 'No approved sign-in waiting for a program: 1 waits'],
      [false, 'No cloud desk wake address: 1 is saved'],
      [false, 'Not named in HB_ADMIN_EMAILS: remove them from it and restart Dovecote'],
    ])
  })
})

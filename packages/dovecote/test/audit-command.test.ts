import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { runAuditCommand } from '../src/audit-command.ts'
import { recordAudit } from '../src/domain/audit.ts'
import { transact } from '../src/events/events.ts'
import { run } from '../src/sql/database.ts'
import { insertInto, sql } from '../src/sql/query.ts'
import { type TestServer, connectAgent, startTestServer, storedRows } from './harness.ts'

let server: TestServer
afterEach(() => server.close())

const command = async (...args: string[]) => {
  const lines: string[] = []
  const code = await T.runPromise(
    runAuditCommand(args, (line) => lines.push(line)),
    server.env,
  )
  return { code, lines }
}

describe('dovecote audit', () => {
  it('verifies the chain on the host, and says where it breaks', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    await connectAgent(server, ana)
    expect(await command('verify')).toEqual({
      code: 0,
      lines: [expect.stringMatching(/^The audit chain holds: 4 rows, head [0-9a-f]{64}\.$/)],
    })
    await T.runPromise(run(sql`UPDATE audit_events SET actor_id = NULL WHERE id = 2`), server.env)
    expect(await command('verify')).toEqual({
      code: 1,
      lines: ['The audit chain is broken at row 2: its hash does not match its content.'],
    })
  })

  it('exports rows as JSON lines, within a date range', async () => {
    server = await startTestServer()
    await server.signIn('ana@example.com')
    await server.clock.advance(3 * 24 * 60 * 60_000)
    await server.signIn('ben@example.com')
    const all = await command('export')
    expect(all.code).toBe(0)
    const rows = all.lines.map((line) => JSON.parse(line))
    expect(rows.map((row) => row.event)).toEqual([
      'credential.issued',
      'authn.signed_in',
      'credential.issued',
      'authn.signed_in',
    ])
    expect(rows[1]).toMatchObject({ id: 2, at: '2023-11-14T22:13:20.000Z', targetKind: 'member', detail: {} })
    const later = await command('export', '--since', '2023-11-16')
    expect(later.lines).toHaveLength(2)
    const earlier = await command('export', '--until', '2023-11-16')
    expect(earlier.lines).toHaveLength(2)
  })

  it('pages through a long trail', async () => {
    server = await startTestServer()
    for (let step = 0; step < 520; step++)
      await T.runPromise(
        transact(recordAudit('system.migrated', { detail: { steps: [step + 1] } })),
        server.env,
      )
    expect((await command('export')).lines).toHaveLength(520)
  })

  it('explains itself when asked for something else', async () => {
    server = await startTestServer()
    for (const args of [[], ['purge'], ['export', '--since'], ['export', '--from', '2026-01-01']])
      expect(await command(...args)).toEqual({
        code: 2,
        lines: [
          'Usage: dovecote audit verify | dovecote audit export [--since YYYY-MM-DD] [--until YYYY-MM-DD] | dovecote audit purge-legacy',
        ],
      })
  })

  it('removes every row of the first audit table on purge-legacy, and records it', async () => {
    server = await startTestServer()
    await T.runPromise(
      run(
        insertInto('audit_log', {
          created_at: server.clock.now(),
          actor_id: null,
          credential_id: null,
          credential_kind: null,
          action: 'drafts.send',
          target: null,
          detail: '{}',
        }),
      ),
      server.env,
    )
    expect(await command('purge-legacy')).toEqual({
      code: 0,
      lines: ['Removed 1 rows of the first audit table, audit_log.'],
    })
    expect(await storedRows(server, 'audit_log')).toEqual([])
    expect((await storedRows(server, 'audit_events')).map((row) => row.event)).toEqual([
      'audit.legacy_purged',
    ])
  })

  it('refuses a database of another version, and migrates nothing', async () => {
    server = await startTestServer()
    await T.runPromise(run(sql`DELETE FROM schema_versions WHERE version = 7`), server.env)
    expect(await command('verify')).toEqual({
      code: 3,
      lines: [
        'This database is older than this Dovecote: start the server once to upgrade it, then run the command again.',
      ],
    })
    expect((await storedRows(server, 'schema_versions')).map((row) => Number(row.version))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
    await T.runPromise(run(sql`INSERT INTO schema_versions (version) VALUES (7), (9)`), server.env)
    expect((await command('export')).code).toBe(3)
    await T.runPromise(run(sql`DROP TABLE schema_versions`), server.env)
    expect((await command('export')).code).toBe(3)
  })
})

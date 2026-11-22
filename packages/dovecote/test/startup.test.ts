import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { run } from '../src/sql/database.ts'
import { insertInto } from '../src/sql/query.ts'
import { announceStart, startDovecote } from '../src/startup.ts'
import { SERVER_VERSION } from '../src/version.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
afterEach(() => server?.close())

const started = async (overrides: Record<string, string> = {}) => {
  server = await startTestServer(overrides)
  await T.runPromise(announceStart(8080), server.env)
  return server.logged.map((line) => JSON.parse(line))
}

describe('starting Dovecote', () => {
  it('says it is listening, warns about development login, and records the start', async () => {
    const lines = await started()
    expect(lines.map((line) => [line.eventName, line.severityText])).toEqual([
      ['system.started', 'INFO'],
      ['system.development_login', 'WARN'],
    ])
    expect(lines[1].attributes).toEqual({ anyAddress: false, firstMemberBecomesAdministrator: true })
    const [row] = await storedRows(server, 'audit_events')
    expect([row!.event, JSON.parse(String(row!.detail))]).toEqual([
      'system.started',
      { version: SERVER_VERSION, tier: 'full', retentionDays: 400 },
    ])
  })

  it('warns once when the audit trail is off, and records nothing', async () => {
    const lines = await started({ HB_LOGS: 'audit=off' })
    expect(lines.filter((line) => line.eventName === 'system.audit_off')).toHaveLength(1)
    expect(await storedRows(server, 'audit_events')).toEqual([])
  })

  it('warns about debug lines and a variable this version does not read', async () => {
    const lines = await started({
      HB_LOGS: 'operational=debug',
      HB_AUDIT_WEBHOOK_URL: 'https://siem.example.com/in',
    })
    expect(lines.map((line) => line.eventName)).toEqual(
      expect.arrayContaining(['system.debug_on', 'system.ignored_variable']),
    )
    expect(JSON.stringify(lines)).not.toContain('siem.example.com')
  })

  it('starts with a variable below 90 days, warning that it keeps 90 and how much was saved before', async () => {
    server = await startTestServer({ HB_AUDIT_RETENTION_DAYS: '30' })
    await T.runPromise(
      run(
        insertInto('settings', {
          name: 'organization',
          value: JSON.stringify({ allowedDomains: [], contactMode: 'open', auditRetentionDays: 365 }),
        }),
      ),
      server.env,
    )
    await T.runPromise(announceStart(8080), server.env)
    const lines = server.logged.map((line) => JSON.parse(line))
    expect(
      lines
        .filter((line) => line.eventName.startsWith('system.audit_retention'))
        .map((line) => [line.eventName, line.severityText, line.attributes]),
    ).toEqual([
      ['system.audit_retention_raised', 'WARN', { requested: 30, days: 90 }],
      ['system.audit_retention_shorter', 'WARN', { saved: 365, days: 90 }],
    ])
    const [row] = await storedRows(server, 'audit_events')
    expect(JSON.parse(String(row!.detail))).toMatchObject({ retentionDays: 90 })
  })

  it('records that it keeps the audit trail forever when an administrator saved that', async () => {
    server = await startTestServer()
    await T.runPromise(
      run(
        insertInto('settings', {
          name: 'organization',
          value: JSON.stringify({ allowedDomains: [], contactMode: 'open', auditRetentionDays: null }),
        }),
      ),
      server.env,
    )
    await T.runPromise(announceStart(8080), server.env)
    const [row] = await storedRows(server, 'audit_events')
    expect(JSON.parse(String(row!.detail))).toMatchObject({ retentionDays: 'forever' })
    expect(server.logged.join('\n')).not.toContain('audit_retention')
  })

  it('runs an audit command against the database as it is, or prepares it and starts', async () => {
    server = await startTestServer()
    const lines: string[] = []
    expect(
      await T.runPromise(
        startDovecote(['audit', 'verify'], 8080, (line) => lines.push(line)),
        server.env,
      ),
    ).toEqual({
      exitCode: 0,
    })
    expect(lines).toEqual([expect.stringMatching(/^The audit chain holds: 0 rows/)])
    expect(
      await T.runPromise(
        startDovecote([], 8080, () => {}),
        server.env,
      ),
    ).toBe('serve')
    expect(server.logged.map((line) => JSON.parse(line).eventName)).toContain('system.started')
  })
})

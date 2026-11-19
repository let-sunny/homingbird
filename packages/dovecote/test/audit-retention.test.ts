import { Task as T } from '@homingbird/kernel'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { auditRetention, auditRetentionWarnings, retentionFrom } from '../src/domain/audit-retention.ts'
import { run } from '../src/sql/database.ts'
import { insertInto } from '../src/sql/query.ts'
import { type TestServer, startTestServer } from './harness.ts'

let server: TestServer
afterEach(() => server?.close())

const withSaved = async (overrides: Record<string, string>, saved: number | null | 'nothing') => {
  server = await startTestServer(overrides)
  if (saved !== 'nothing')
    await T.runPromise(
      run(
        insertInto('settings', {
          name: 'organization',
          value: JSON.stringify({ allowedDomains: [], contactMode: 'open', auditRetentionDays: saved }),
        }),
      ),
      server.env,
    )
  return {
    days: await T.runPromise(auditRetention, server.env),
    warnings: await T.runPromise(auditRetentionWarnings, server.env),
  }
}

describe('audit retention', () => {
  it('never keeps rows for less than the configuration, and follows the variable whenever it is set', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 90, max: 36_500 }),
        fc.option(fc.integer({ min: 1, max: 36_500 })),
        fc.option(fc.oneof(fc.integer({ min: 1, max: 36_500 }), fc.constant('forever' as const))),
        (configured, variable, saved) => {
          const kept = retentionFrom(
            { auditRetentionDays: configured, auditRetentionVariableDays: variable },
            saved,
          )
          if (variable !== null || saved === null) expect(kept).toBe(configured)
          else if (saved === 'forever') expect(kept).toBe('forever')
          else expect(kept).toBe(Math.max(configured, saved))
        },
      ),
    )
  })

  it('keeps the default and warns of nothing when nothing was saved', async () => {
    expect(await withSaved({}, 'nothing')).toEqual({ days: 400, warnings: [] })
  })

  it('keeps a longer saved retention without a warning while the variable is unset', async () => {
    expect(await withSaved({}, 700)).toEqual({ days: 700, warnings: [] })
  })

  it('warns once when the retention kept is shorter than what was saved', async () => {
    expect(await withSaved({}, 200)).toEqual({ days: 400, warnings: [] })
    await server.close()
    expect(await withSaved({ HB_AUDIT_RETENTION_DAYS: '365' }, 700)).toEqual({
      days: 365,
      warnings: [{ kind: 'shorter', saved: 700, days: 365 }],
    })
  })

  it('warns that a variable below the minimum was raised to 90 days', async () => {
    expect(await withSaved({ HB_AUDIT_RETENTION_DAYS: '30' }, 'nothing')).toEqual({
      days: 90,
      warnings: [{ kind: 'raised', requested: 30, days: 90 }],
    })
  })

  it('keeps every row when an administrator saved keep forever and the variable is unset', async () => {
    expect(await withSaved({}, null)).toEqual({ days: 'forever', warnings: [] })
  })

  it('warns that the variable shortens a saved keep forever', async () => {
    expect(await withSaved({ HB_AUDIT_RETENTION_DAYS: '365' }, null)).toEqual({
      days: 365,
      warnings: [{ kind: 'shorter', saved: 'forever', days: 365 }],
    })
  })
})

import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, type HasSql, run, sqlEnvironment } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { raw } from '../src/sql/query.ts'
import { migrate, requireCurrentSchema, schemaStatements, tableNames } from '../src/sql/schema.ts'
import { openSqlite } from '../src/sql/sqlite.ts'

let database: Database
let env: HasSql

beforeEach(() => {
  database = openSqlite(':memory:')
  env = sqlEnvironment(database)
})

afterEach(() => T.runPromise(database.close))

describe('the schema', () => {
  it('applies every step once to an empty database, and none the second time', async () => {
    expect(await T.runPromise(migrate, env)).toEqual(MIGRATIONS.map((_, index) => index + 1))
    expect(await T.runPromise(migrate, env)).toEqual([])
    expect(await T.runPromise(T.result(requireCurrentSchema), env)).toEqual({ _tag: 'Ok', value: undefined })
  })

  it('leaves a database alone that has tables but no record of this schema', async () => {
    await T.runPromise(run(raw('CREATE TABLE members (id TEXT)')), env)
    const refused = await T.runPromise(T.result(migrate), env)
    expect(refused).toMatchObject({ _tag: 'Err', error: { _tag: 'UnknownDatabase' } })
  })

  it('leaves a database alone that a newer Dovecote migrated, and says to run that version or restore the backup', async () => {
    await T.runPromise(migrate, env)
    await T.runPromise(
      run(raw(`INSERT INTO schema_versions (version) VALUES (${MIGRATIONS.length + 1})`)),
      env,
    )
    const newer = {
      _tag: 'Err',
      error: {
        _tag: 'UnknownDatabase',
        message: `This database was upgraded by a newer Dovecote (schema step ${MIGRATIONS.length + 1}; this version knows ${MIGRATIONS.length}), so it is left untouched: run that newer version, or restore the backup you took before upgrading.`,
      },
    }
    expect(await T.runPromise(T.result(migrate), env)).toEqual(newer)
    expect(await T.runPromise(T.result(requireCurrentSchema), env)).toEqual(newer)
  })

  it('tells a read-only command to start the server first on an older database, without migrating it', async () => {
    await T.runPromise(migrate, env)
    await T.runPromise(run(raw(`DELETE FROM schema_versions WHERE version = ${MIGRATIONS.length}`)), env)
    const refused = await T.runPromise(T.result(requireCurrentSchema), env)
    expect(refused).toMatchObject({
      _tag: 'Err',
      error: { message: expect.stringContaining('start the server once to upgrade it') },
    })
    expect(
      await T.runPromise(
        T.map((versions: ReadonlyArray<unknown>) => versions.length)(
          database.all(raw('SELECT version FROM schema_versions')),
        ),
      ),
    ).toBe(MIGRATIONS.length - 1)
  })

  it('tells a read-only command that a database with no Dovecote tables is not the server’s, and calls it neither older nor newer', async () => {
    expect(await T.runPromise(T.result(requireCurrentSchema), env)).toEqual({
      _tag: 'Err',
      error: {
        _tag: 'UnknownDatabase',
        message:
          'This database holds no Dovecote tables: check that HB_DATABASE_URL names the server’s database.',
      },
    })
    expect(
      await T.runPromise(database.all(raw("SELECT name FROM sqlite_master WHERE type = 'table'"))),
    ).toEqual([])
  })

  it('names every table, the version table first, and writes each dialect’s statements', () => {
    expect(tableNames()[0]).toBe('schema_versions')
    expect(tableNames()).toEqual(expect.arrayContaining(['members', 'notes', 'audit_events', 'debate_votes']))
    expect(schemaStatements('mysql').some((statement) => statement.includes('AUTO_INCREMENT'))).toBe(true)
    expect(
      schemaStatements('postgres').some((statement) => statement.includes('GENERATED ALWAYS AS IDENTITY')),
    ).toBe(true)
    expect(schemaStatements('sqlite').some((statement) => statement.includes('AUTOINCREMENT'))).toBe(true)
  })
})

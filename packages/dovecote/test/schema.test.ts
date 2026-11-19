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

  it('leaves a database alone that a newer Dovecote migrated', async () => {
    await T.runPromise(migrate, env)
    await T.runPromise(
      run(raw(`INSERT INTO schema_versions (version) VALUES (${MIGRATIONS.length + 1})`)),
      env,
    )
    expect(await T.runPromise(T.result(migrate), env)).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'UnknownDatabase' },
    })
    expect(await T.runPromise(T.result(requireCurrentSchema), env)).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'UnknownDatabase' },
    })
  })

  it('tells a read-only command to start the server first on an older database, without migrating it', async () => {
    const refused = await T.runPromise(T.result(requireCurrentSchema), env)
    expect(refused).toMatchObject({
      _tag: 'Err',
      error: { message: expect.stringContaining('start the server once to upgrade it') },
    })
    expect(await T.runPromise(migrate, env)).toHaveLength(MIGRATIONS.length)
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

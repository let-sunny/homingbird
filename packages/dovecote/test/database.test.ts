import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Database,
  type HasSql,
  all,
  dialect,
  driverCall,
  first,
  inTransaction,
  run,
  sqlEnvironment,
} from '../src/sql/database.ts'
import { raw, sql } from '../src/sql/query.ts'
import { openSqlite } from '../src/sql/sqlite.ts'

let database: Database
let env: HasSql

beforeEach(async () => {
  database = openSqlite(':memory:')
  env = sqlEnvironment(database)
  await T.runPromise(run(raw('CREATE TABLE items (id TEXT PRIMARY KEY, n INTEGER)')), env)
})

afterEach(() => T.runPromise(database.close))

const count = async () =>
  (await T.runPromise(first<{ total: number }>(raw('SELECT COUNT(*) AS total FROM items')), env))?.total

describe('the database helpers', () => {
  it('read rows, the first row or none, and say how many rows a statement changed', async () => {
    expect(
      await T.runPromise(run(sql`INSERT INTO items (id, n) VALUES (${'a'}, ${1}), (${'b'}, ${2})`), env),
    ).toBe(2)
    expect(await T.runPromise(all(raw('SELECT id FROM items ORDER BY id')), env)).toEqual([
      { id: 'a' },
      { id: 'b' },
    ])
    expect(await T.runPromise(first(sql`SELECT n FROM items WHERE id = ${'b'}`), env)).toEqual({ n: 2 })
    expect(await T.runPromise(first(sql`SELECT n FROM items WHERE id = ${'z'}`), env)).toBeNull()
    expect(await T.runPromise(dialect, env)).toBe('sqlite')
  })

  it('commit a transaction that succeeds and roll back one that fails', async () => {
    await T.runPromise(inTransaction(run(raw("INSERT INTO items (id, n) VALUES ('a', 1)"))), env)
    const failed = await T.run(
      inTransaction(
        T.flatMap(() => T.fail('refused' as const))(run(raw("INSERT INTO items (id, n) VALUES ('b', 2)"))),
      ),
      env,
    )
    expect(failed._tag).toBe('Err')
    expect(await count()).toBe(1)
  })

  it('join the transaction already open instead of opening another', async () => {
    await T.runPromise(
      inTransaction(
        T.gen(function* () {
          yield* run(raw("INSERT INTO items (id, n) VALUES ('a', 1)"))
          yield* inTransaction(run(raw("INSERT INTO items (id, n) VALUES ('b', 2)")))
        }),
      ),
      env,
    )
    expect(await count()).toBe(2)
  })

  it('run a driver call to its end once it started, even when interrupted', async () => {
    const controller = new AbortController()
    let finished = false
    const call = driverCall(async () => {
      await Promise.resolve()
      finished = true
      return 'done'
    })
    const running = T.run(call, {}, controller.signal)
    controller.abort()
    expect(await running).toMatchObject({ _tag: 'Ok', value: 'done' })
    expect(finished).toBe(true)
  })
})

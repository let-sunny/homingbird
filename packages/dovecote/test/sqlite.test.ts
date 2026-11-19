import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Task as T, makeTestClock } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { raw } from '../src/sql/query.ts'
import { openSqlite } from '../src/sql/sqlite.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('the SQLite driver', () => {
  it('creates the folder of a new database file and keeps what was written after reopening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dovecote-sqlite-'))
    directories.push(directory)
    const path = join(directory, 'nested', 'dovecote.sqlite')
    const first = openSqlite(path)
    await T.runPromise(first.run(raw('CREATE TABLE kept (id TEXT)')))
    await T.runPromise(first.run(raw("INSERT INTO kept VALUES ('a')")))
    await T.runPromise(first.close)
    const second = openSqlite(path)
    expect(await T.runPromise(second.all(raw('SELECT id FROM kept')))).toEqual([{ id: 'a' }])
    await T.runPromise(second.close)
  })

  it('rolls a transaction back when its body fails, and commits it when it succeeds', async () => {
    const database = openSqlite(':memory:')
    await T.runPromise(database.run(raw('CREATE TABLE items (id TEXT)')))
    const failed = await T.run(
      database.transaction((connection) =>
        T.flatMap(() => T.fail('refused'))(connection.run(raw("INSERT INTO items VALUES ('a')"))),
      ),
    )
    expect(failed._tag).toBe('Err')
    await T.runPromise(
      database.transaction((connection) => connection.run(raw("INSERT INTO items VALUES ('b')"))),
    )
    expect(await T.runPromise(database.all(raw('SELECT id FROM items')))).toEqual([{ id: 'b' }])
    await T.runPromise(database.close)
  })

  it('runs one statement or transaction at a time, so a transaction never sees another half done', async () => {
    const database = openSqlite(':memory:')
    await T.runPromise(database.run(raw('CREATE TABLE items (id TEXT)')))
    const seen: number[] = []
    const writer = database.transaction((connection) =>
      T.gen(function* () {
        yield* connection.run(raw("INSERT INTO items VALUES ('a')"))
        yield* T.sleep(5)
        yield* connection.run(raw("INSERT INTO items VALUES ('b')"))
      }),
    )
    const reader = T.map((rows: ReadonlyArray<unknown>) => void seen.push(rows.length))(
      database.all(raw('SELECT id FROM items')),
    )
    const clock = makeTestClock()
    const writing = T.runPromise(writer, { clock })
    const reading = T.runPromise(reader)
    await clock.advance(5)
    await Promise.all([writing, reading])
    expect(seen).toEqual([2])
    await T.runPromise(database.close)
  })

  it('counts the rows a statement changed', async () => {
    const database = openSqlite(':memory:')
    await T.runPromise(database.run(raw('CREATE TABLE items (id TEXT)')))
    expect(await T.runPromise(database.run(raw("INSERT INTO items VALUES ('a'), ('b')")))).toEqual({
      changes: 2,
    })
    await T.runPromise(database.close)
  })
})

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { raw } from '../src/sql/query.ts'
import { databasePlaceOf, databaseUnreachable, openReachableDatabase } from '../src/sql/reachable.ts'

describe('opening a database that answers', () => {
  it('opens a database that answers a question', async () => {
    const database = await T.runPromise(openReachableDatabase('sqlite::memory:'))
    expect(await T.runPromise(database.all(raw('SELECT 1 AS one')))).toEqual([{ one: 1 }])
    await T.runPromise(database.close)
  })

  it('says in one sentence where a database it cannot open is, and why', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hb-reachable-')), 'a-file')
    writeFileSync(file, '')
    const refused = await T.runPromise(T.result(openReachableDatabase(`sqlite:${file}/dovecote.sqlite`)))
    expect(refused).toMatchObject({
      _tag: 'Err',
      error: {
        _tag: 'DatabaseUnreachable',
        code: expect.stringMatching(/^E[A-Z]+$/),
        message: expect.stringMatching(
          new RegExp(
            `^Dovecote cannot reach the database at ${file}/dovecote\\.sqlite: .+ \\(E[A-Z]+\\)\\.$`,
          ),
        ),
      },
    })
  })

  it('keeps refusing an address that names no database it supports', async () => {
    expect(await T.runPromise(T.result(openReachableDatabase('redis://cache')))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'UnsupportedDatabase' },
    })
  })
})

describe('the sentence for a database that does not answer', () => {
  it('names the host, port, database, the driver’s reason and its code, never the password', () => {
    const failure = Object.assign(new Error('password authentication failed for user "homingbird"'), {
      code: '28P01',
    })
    expect(
      databaseUnreachable('postgres://homingbird:s3cr%40t@db.internal:5432/homingbird', failure),
    ).toEqual({
      _tag: 'DatabaseUnreachable',
      code: '28P01',
      message:
        'Dovecote cannot reach the database at db.internal:5432/homingbird: password authentication failed for user "homingbird" (28P01).',
    })
  })

  it('removes the password where a driver quotes it, encoded or not', () => {
    const url = 'mysql://app:p%40ss@db.internal/homingbird'
    const said = databaseUnreachable(url, new Error('Access denied for app using p@ss and p%40ss.'))
    expect(said.message).toBe(
      'Dovecote cannot reach the database at db.internal:3306/homingbird: Access denied for app using [password] and [password].',
    )
    expect(said.message).not.toContain('p@ss')
  })

  it('says so when a driver gives neither a reason nor a code it can trust', () => {
    expect(
      databaseUnreachable('postgres://db/homingbird', Object.assign(new Error(''), { code: 'bad code!' })),
    ).toEqual({
      _tag: 'DatabaseUnreachable',
      code: 'unknown',
      message: 'Dovecote cannot reach the database at db:5432/homingbird: no reason given.',
    })
    expect(databaseUnreachable('postgres://db/homingbird', 'ECONNRESET').message).toBe(
      'Dovecote cannot reach the database at db:5432/homingbird: ECONNRESET.',
    )
  })

  it('names a SQLite file by its path, and an address it cannot read without quoting it', () => {
    expect(databasePlaceOf('sqlite:/data/dovecote.sqlite')).toBe('/data/dovecote.sqlite')
    expect(databasePlaceOf('postgres://user:secret@[::1]:6543/hb')).toBe('[::1]:6543/hb')
    expect(databasePlaceOf('postgres://user:secret@bad host/hb')).toBe('the address in HB_DATABASE_URL')
  })
})

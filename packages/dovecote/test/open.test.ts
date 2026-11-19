import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/sql/open.ts'
import { raw } from '../src/sql/query.ts'

describe('opening the database a URL names', () => {
  it('opens SQLite for a sqlite: URL, loading only that driver', async () => {
    const database = await T.runPromise(openDatabase('sqlite::memory:'))
    expect(database.dialect).toBe('sqlite')
    expect(await T.runPromise(database.all(raw('SELECT 1 AS one')))).toEqual([{ one: 1 }])
    await T.runPromise(database.close)
  })

  it('opens PostgreSQL for both spellings of its scheme, and MySQL for mysql:, without connecting yet', async () => {
    for (const url of [
      'postgres://u:p@127.0.0.1:1/db',
      'postgresql://u:p@127.0.0.1:1/db',
      'mysql://u:p@127.0.0.1:1/db',
    ]) {
      const database = await T.runPromise(openDatabase(url))
      expect(database.dialect).toBe(url.startsWith('mysql') ? 'mysql' : 'postgres')
      await T.runPromise(database.close)
    }
  })

  it('refuses any other URL with a sentence naming the three it takes', async () => {
    expect(await T.runPromise(T.result(openDatabase('oracle://db')))).toMatchObject({
      _tag: 'Err',
      error: {
        _tag: 'UnsupportedDatabase',
        message: 'HB_DATABASE_URL must start with sqlite:, postgres: or mysql:',
      },
    })
  })
})

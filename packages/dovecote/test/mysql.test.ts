import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { openMysql } from '../src/sql/mysql.ts'
import { raw } from '../src/sql/query.ts'

const UNREACHABLE = 'mysql://dovecote:secret@127.0.0.1:1/homingbird'

describe('the MySQL driver', () => {
  it('opens a pool without connecting, so the server starts before the database answers', async () => {
    const database = openMysql(UNREACHABLE)
    expect(database.dialect).toBe('mysql')
    await T.runPromise(database.close)
  })

  it('treats a database it cannot reach as a defect, not as an empty answer', async () => {
    const database = openMysql(UNREACHABLE)
    const read = await T.run(database.all(raw('SELECT 1')))
    expect(read._tag).toBe('Err')
    const transaction = await T.run(database.transaction((connection) => connection.run(raw('SELECT 1'))))
    expect(transaction._tag).toBe('Err')
    await T.runPromise(database.close)
  })
})

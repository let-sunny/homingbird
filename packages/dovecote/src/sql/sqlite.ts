import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Connection, Database, Row } from './database.ts'
import type { Query } from './query.ts'

export const openSqlite = (path: string): Database => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

  const connection: Connection = {
    dialect: 'sqlite',
    all: async (query) => db.prepare(query.text).all(...bindable(query)) as Row[],
    run: async (query) => ({ changes: Number(db.prepare(query.text).run(...bindable(query)).changes) }),
  }

  let queue: Promise<unknown> = Promise.resolve()
  const exclusively = <A>(work: () => Promise<A>): Promise<A> => {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
  }

  return {
    dialect: 'sqlite',
    all: (query) => exclusively(() => connection.all(query)),
    run: (query) => exclusively(() => connection.run(query)),
    transaction: (body) =>
      exclusively(async () => {
        db.exec('BEGIN IMMEDIATE')
        try {
          const result = await body(connection)
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }),
    close: () => exclusively(async () => db.close()),
  }
}

const bindable = (query: Query) => query.params as Array<string | number | null>

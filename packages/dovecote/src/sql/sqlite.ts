import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Task as T, makeMutex } from '@homingbird/kernel'
import type { Connection, Database, Row } from './database.ts'
import type { Query } from './query.ts'

/** One connection, used by one statement or transaction at a time, so no transaction sees another's work. */
export const openSqlite = (path: string): Database => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

  const connection: Connection = {
    dialect: 'sqlite',
    all: (query) => T.sync(() => db.prepare(query.text).all(...bindable(query)) as Row[]),
    run: (query) =>
      T.sync(() => ({ changes: Number(db.prepare(query.text).run(...bindable(query)).changes) })),
  }
  const exclusively = makeMutex().withPermit

  return {
    dialect: 'sqlite',
    all: (query) => exclusively(connection.all(query)),
    run: (query) => exclusively(connection.run(query)),
    transaction: (body) =>
      exclusively(
        T.gen(function* () {
          let committed = false
          db.exec('BEGIN IMMEDIATE')
          try {
            const result = yield* body(connection)
            db.exec('COMMIT')
            committed = true
            return result
          } finally {
            if (!committed) db.exec('ROLLBACK')
          }
        }),
      ),
    close: exclusively(T.sync(() => db.close())),
  }
}

const bindable = (query: Query) => query.params as Array<string | number | null>

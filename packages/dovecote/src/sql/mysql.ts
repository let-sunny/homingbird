import { Task as T } from '@homingbird/kernel'
import mysql from 'mysql2/promise'
import { type Connection, type Database, type Row, driverCall } from './database.ts'

export const openMysql = (url: string): Database => {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 10,
    charset: 'utf8mb4',
    supportBigNumbers: true,
  })
  const over = (client: mysql.Pool | mysql.PoolConnection): Connection => ({
    dialect: 'mysql',
    all: (query) =>
      T.map(([rows]: [unknown, unknown]) => rows as Row[])(
        driverCall(() => client.query(query.text, [...query.params])),
      ),
    run: (query) =>
      T.map(([header]: [unknown, unknown]) => ({ changes: (header as mysql.ResultSetHeader).affectedRows }))(
        driverCall(() => client.query(query.text, [...query.params])),
      ),
  })
  return {
    ...over(pool),
    transaction: (body) =>
      T.bracket(
        driverCall(() => pool.getConnection()),
        (client) =>
          T.gen(function* () {
            let committed = false
            try {
              yield* driverCall(() => client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'))
              yield* driverCall(() => client.beginTransaction())
              const result = yield* body(over(client))
              yield* driverCall(() => client.commit())
              committed = true
              return result
            } finally {
              if (!committed) yield* driverCall(() => client.rollback())
            }
          }),
        (client) => T.sync(() => client.release()),
      ),
    close: driverCall(() => pool.end()),
  }
}

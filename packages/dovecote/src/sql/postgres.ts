import { Task as T } from '@homingbird/kernel'
import pg from 'pg'
import { type Connection, type Database, type Row, driverCall } from './database.ts'
import { numberedPlaceholders } from './query.ts'

export const openPostgres = (url: string): Database => {
  const pool = new pg.Pool(poolOptionsFor(url))
  const over = (client: pg.Pool | pg.PoolClient): Connection => ({
    dialect: 'postgres',
    all: (query) =>
      T.map((result: pg.QueryResult) => result.rows as Row[])(
        driverCall(() => client.query(numberedPlaceholders(query.text), [...query.params])),
      ),
    run: (query) =>
      T.map((result: pg.QueryResult) => ({ changes: result.rowCount ?? 0 }))(
        driverCall(() => client.query(numberedPlaceholders(query.text), [...query.params])),
      ),
  })
  return {
    ...over(pool),
    transaction: (body) =>
      T.bracket(
        driverCall(() => pool.connect()),
        (client) =>
          T.gen(function* () {
            let committed = false
            try {
              yield* driverCall(() => client.query('BEGIN'))
              const result = yield* body(over(client))
              yield* driverCall(() => client.query('COMMIT'))
              committed = true
              return result
            } finally {
              if (!committed) yield* driverCall(() => client.query('ROLLBACK'))
            }
          }),
        (client) => T.sync(() => client.release()),
      ),
    close: driverCall(() => pool.end()),
  }
}

export const poolOptionsFor = (url: string): pg.PoolConfig => ({
  connectionString: url,
  max: 10,
  types: bigintsAsNumbers,
})

const BIGINT_OID = 20

const bigintsAsNumbers = {
  getTypeParser: (oid: number, format?: string) =>
    oid === BIGINT_OID ? Number : pg.types.getTypeParser(oid, format as 'text'),
} as pg.CustomTypesConfig

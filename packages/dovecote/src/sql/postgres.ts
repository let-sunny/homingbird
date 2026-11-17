import pg from 'pg'
import type { Connection, Database, Row } from './database.ts'
import { numberedPlaceholders } from './query.ts'

export const openPostgres = (url: string): Database => {
  const pool = new pg.Pool({ connectionString: url, max: 10, types: bigintsAsNumbers })
  const over = (client: pg.Pool | pg.PoolClient): Connection => ({
    dialect: 'postgres',
    all: async (query) => (await client.query(numberedPlaceholders(query.text), [...query.params])).rows as Row[],
    run: async (query) => ({
      changes: (await client.query(numberedPlaceholders(query.text), [...query.params])).rowCount ?? 0,
    }),
  })
  return {
    ...over(pool),
    transaction: async (body) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await body(over(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

const BIGINT_OID = 20

const bigintsAsNumbers = {
  getTypeParser: (oid: number, format?: string) =>
    oid === BIGINT_OID ? Number : pg.types.getTypeParser(oid, format as 'text'),
} as pg.CustomTypesConfig

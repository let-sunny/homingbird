import mysql from 'mysql2/promise'
import type { Connection, Database, Row } from './database.ts'

export const openMysql = (url: string): Database => {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 10,
    charset: 'utf8mb4',
    supportBigNumbers: true,
  })
  const over = (client: mysql.Pool | mysql.PoolConnection): Connection => ({
    dialect: 'mysql',
    all: async (query) => (await client.query(query.text, [...query.params]))[0] as Row[],
    run: async (query) => ({
      changes: ((await client.query(query.text, [...query.params]))[0] as mysql.ResultSetHeader).affectedRows,
    }),
  })
  return {
    ...over(pool),
    transaction: async (body) => {
      const client = await pool.getConnection()
      try {
        await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
        await client.beginTransaction()
        const result = await body(over(client))
        await client.commit()
        return result
      } catch (error) {
        await client.rollback()
        throw error
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

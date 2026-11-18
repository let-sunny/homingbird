import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/sql/open.ts'
import { poolOptionsFor } from '../src/sql/postgres.ts'
import { raw } from '../src/sql/query.ts'
import { startTestServer } from './harness.ts'

const SOCKET_URL = process.env.HB_TEST_POSTGRES_SOCKET_URL

const settingsOf = (url: string) => {
  const client = new pg.Client(poolOptionsFor(url))
  return {
    host: client.host,
    port: client.port,
    user: client.user,
    password: client.password,
    database: client.database,
  }
}

describe('a PostgreSQL URL', () => {
  it('names a Cloud SQL Unix socket directory as the host, the way the GCP Terraform writes it', () => {
    expect(
      settingsOf('postgres://dovecote:s3cret@/homingbird?host=/cloudsql/acme-prod:europe-west1:dovecote'),
    ).toEqual({
      host: '/cloudsql/acme-prod:europe-west1:dovecote',
      port: 5432,
      user: 'dovecote',
      password: 's3cret',
      database: 'homingbird',
    })
  })

  it('reads a host and port over TCP and decodes an escaped password', () => {
    expect(settingsOf('postgresql://dovecote:p%40ss%2Fword@db.internal:6543/homingbird')).toEqual({
      host: 'db.internal',
      port: 6543,
      user: 'dovecote',
      password: 'p@ss/word',
      database: 'homingbird',
    })
  })
})

describe('Dovecote on PostgreSQL through a Unix socket', () => {
  it.skipIf(SOCKET_URL === undefined)('connects with a URL whose host is a socket directory', async () => {
    const database = await openDatabase(SOCKET_URL!)
    try {
      const [connection] = await database.all(raw('SELECT inet_server_addr() AS address'))
      expect(connection).toEqual({ address: null })
    } finally {
      await database.close()
    }
  })

  it.skipIf(SOCKET_URL === undefined)('runs the server and signs a person in over the socket', async () => {
    const server = await startTestServer({}, { databaseUrl: SOCKET_URL! })
    try {
      const ana = await server.signIn('ana@example.com', 'Ana')
      expect(ana.me.member.email).toBe('ana@example.com')
    } finally {
      await server.close()
    }
  })
})

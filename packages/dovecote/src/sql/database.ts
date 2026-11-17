import { Task as T, ok } from '@homingbird/kernel'
import type { Query } from './query.ts'

export type Dialect = 'sqlite' | 'postgres' | 'mysql'

export type Row = Readonly<Record<string, unknown>>

export interface Connection {
  readonly dialect: Dialect
  readonly all: (query: Query) => Promise<ReadonlyArray<Row>>
  readonly run: (query: Query) => Promise<{ readonly changes: number }>
}

export interface Database extends Connection {
  readonly transaction: <A>(body: (connection: Connection) => Promise<A>) => Promise<A>
  readonly close: () => Promise<void>
}

export interface HasSql {
  readonly database: Database
  readonly connection: Connection
}

export const all = <R = Row>(query: Query): T.Task<ReadonlyArray<R>, never, HasSql> =>
  T.make(async (env) => ok((await env.connection.all(query)) as ReadonlyArray<R>))

export const first = <R = Row>(query: Query): T.Task<R | null, never, HasSql> =>
  T.map((rows: ReadonlyArray<R>) => rows[0] ?? null)(all<R>(query))

export const run = (query: Query): T.Task<number, never, HasSql> =>
  T.make(async (env) => ok((await env.connection.run(query)).changes))

export const dialect: T.Task<Dialect, never, HasSql> = T.make((env) => ok(env.connection.dialect))

export const inTransaction = <A, E, R>(task: T.Task<A, E, R>): T.Task<A, E, R & HasSql> =>
  T.make<A, E, R & HasSql>(async (env, signal) => {
    if (env.connection !== env.database) return task.run(env, signal)
    try {
      return await env.database.transaction(async (connection) => {
        const exit = await task.run({ ...env, connection }, signal)
        if (exit._tag === 'Err') throw { [ROLLBACK]: exit } satisfies Rollback
        return exit
      })
    } catch (thrown) {
      if (isRollback(thrown)) return thrown[ROLLBACK] as T.Exit<A, E>
      throw thrown
    }
  })

export const sqlEnvironment = (database: Database): HasSql => ({ database, connection: database })

const ROLLBACK = Symbol('rollback')

interface Rollback {
  readonly [ROLLBACK]: T.Exit<unknown, unknown>
}

const isRollback = (thrown: unknown): thrown is Rollback =>
  typeof thrown === 'object' && thrown !== null && ROLLBACK in thrown

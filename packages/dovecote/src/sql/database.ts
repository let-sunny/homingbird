import { Task as T } from '@homingbird/kernel'
import type { Query } from './query.ts'

export type Dialect = 'sqlite' | 'postgres' | 'mysql'

export type Row = Readonly<Record<string, unknown>>

export interface Connection {
  readonly dialect: Dialect
  readonly all: (query: Query) => T.Task<ReadonlyArray<Row>>
  readonly run: (query: Query) => T.Task<{ readonly changes: number }>
}

/** A transaction commits when its body succeeds and rolls back when it fails, dies or is interrupted. */
export interface Database extends Connection {
  readonly transaction: <A, E, R>(body: (connection: Connection) => T.Task<A, E, R>) => T.Task<A, E, R>
  readonly close: T.Task<void>
}

export interface HasSql {
  readonly database: Database
  readonly connection: Connection
}

export const all = <R = Row>(query: Query): T.Task<ReadonlyArray<R>, never, HasSql> =>
  T.flatMap((env: HasSql) => env.connection.all(query) as T.Task<ReadonlyArray<R>>)(T.ask<HasSql>())

export const first = <R = Row>(query: Query): T.Task<R | null, never, HasSql> =>
  T.map((rows: ReadonlyArray<R>) => rows[0] ?? null)(all<R>(query))

export const run = (query: Query): T.Task<number, never, HasSql> =>
  T.flatMap((env: HasSql) =>
    T.map((done: { readonly changes: number }) => done.changes)(env.connection.run(query)),
  )(T.ask<HasSql>())

export const dialect: T.Task<Dialect, never, HasSql> = T.map((env: HasSql) => env.connection.dialect)(
  T.ask<HasSql>(),
)

export const inTransaction = <A, E, R>(task: T.Task<A, E, R>): T.Task<A, E, R & HasSql> =>
  T.flatMap((env: HasSql) =>
    env.connection !== env.database
      ? task
      : env.database.transaction((connection) => T.provide({ connection })(task) as T.Task<A, E, R>),
  )(T.ask<HasSql>())

export const sqlEnvironment = (database: Database): HasSql => ({ database, connection: database })

/** A driver call runs to its end once started, as a database cannot take back a statement it was sent. */
export const driverCall = <A>(call: () => Promise<A>): T.Task<A> => T.uninterruptible(T.promise(call))

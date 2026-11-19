import { Task as T, tagged } from '@homingbird/kernel'
import type { Database } from './database.ts'

export const openDatabase = (url: string): T.Task<Database, UnsupportedDatabase> => {
  if (url.startsWith('sqlite:'))
    return T.map((driver: typeof import('./sqlite.ts')) => driver.openSqlite(url.slice('sqlite:'.length)))(
      T.promise(() => import('./sqlite.ts')),
    )
  if (/^postgres(ql)?:/.test(url))
    return T.map((driver: typeof import('./postgres.ts')) => driver.openPostgres(url))(
      T.promise(() => import('./postgres.ts')),
    )
  if (url.startsWith('mysql:'))
    return T.map((driver: typeof import('./mysql.ts')) => driver.openMysql(url))(
      T.promise(() => import('./mysql.ts')),
    )
  return T.fail(
    UnsupportedDatabase({ message: 'HB_DATABASE_URL must start with sqlite:, postgres: or mysql:' }),
  )
}

const UnsupportedDatabase = tagged('UnsupportedDatabase')<{ readonly message: string }>()
type UnsupportedDatabase = ReturnType<typeof UnsupportedDatabase>

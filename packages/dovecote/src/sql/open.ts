import type { Database } from './database.ts'

export const openDatabase = async (url: string): Promise<Database> => {
  if (url.startsWith('sqlite:')) return (await import('./sqlite.ts')).openSqlite(url.slice('sqlite:'.length))
  if (/^postgres(ql)?:/.test(url)) return (await import('./postgres.ts')).openPostgres(url)
  if (url.startsWith('mysql:')) return (await import('./mysql.ts')).openMysql(url)
  throw new RangeError('HB_DATABASE_URL must start with sqlite:, postgres: or mysql:')
}

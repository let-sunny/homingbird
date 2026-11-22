import { Task as T, tagged } from '@homingbird/kernel'
import type { Database } from './database.ts'
import { type UnsupportedDatabase, openDatabase } from './open.ts'
import { raw } from './query.ts'

/** Opens the database and asks it one question, so a wrong address or password is told at start. */
export const openReachableDatabase = (
  url: string,
): T.Task<Database, DatabaseUnreachable | UnsupportedDatabase> =>
  T.gen(function* () {
    const opened = yield* T.exit(openDatabase(url))
    if (opened._tag === 'Err') {
      if (opened.error._tag !== 'Die') return yield* T.fromExit<Database, UnsupportedDatabase>(opened)
      return yield* T.fail(databaseUnreachable(url, opened.error.defect))
    }
    const database = opened.value
    const asked = yield* T.exit(database.all(raw('SELECT 1')))
    if (asked._tag === 'Ok') return database
    yield* T.exit(database.close)
    if (asked.error._tag !== 'Die') return yield* T.fromExit<Database, never>(asked)
    return yield* T.fail(databaseUnreachable(url, asked.error.defect))
  })

const DatabaseUnreachable = tagged('DatabaseUnreachable')<{
  readonly message: string
  readonly code: string
}>()
export type DatabaseUnreachable = ReturnType<typeof DatabaseUnreachable>

export const databaseUnreachable = (url: string, defect: unknown): DatabaseUnreachable => {
  const code = codeOf(defect)
  const reason = withoutSecrets(url, defect instanceof Error ? defect.message : String(defect))
  return DatabaseUnreachable({
    message: `Dovecote cannot reach the database at ${databasePlaceOf(url)}: ${reason || 'no reason given'}${code === 'unknown' ? '' : ` (${code})`}.`,
    code,
  })
}

export const databasePlaceOf = (url: string): string => {
  if (url.startsWith('sqlite:')) return url.slice('sqlite:'.length)
  const parsed = URL.parse(url)
  if (parsed === null) return 'the address in HB_DATABASE_URL'
  const port = parsed.port || (parsed.protocol === 'mysql:' ? '3306' : '5432')
  return `${parsed.hostname}:${port}${parsed.pathname}`
}

const codeOf = (defect: unknown): string => {
  const code = (defect as { readonly code?: unknown } | null)?.code
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : 'unknown'
}

const withoutSecrets = (url: string, message: string): string => {
  const password = URL.parse(url)?.password ?? ''
  const secrets = [password, safeDecode(password)].filter((secret) => secret.length > 0)
  return secrets
    .reduce((text, secret) => text.split(secret).join('[password]'), message)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .slice(0, 300)
}

const safeDecode = (text: string): string =>
  /%(?![0-9A-Fa-f]{2})/.test(text) ? text : decodeURIComponent(text)

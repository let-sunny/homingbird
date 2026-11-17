import type { Dialect } from './database.ts'

export interface Query {
  readonly text: string
  readonly params: ReadonlyArray<unknown>
}

export const sql = (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>): Query => {
  let text = strings[0]!
  const params: unknown[] = []
  values.forEach((value, index) => {
    const fragment = toFragment(value)
    text += fragment.text + strings[index + 1]!
    params.push(...fragment.params)
  })
  return query(text, params)
}

export const raw = (text: string): Query => query(text, [])

export const join = (parts: ReadonlyArray<Query>, separator: string): Query =>
  query(
    parts.map((part) => part.text).join(separator),
    parts.flatMap((part) => part.params),
  )

export const list = (values: ReadonlyArray<unknown>): Query => {
  if (values.length === 0) throw new RangeError('an SQL list needs at least one value')
  return query(`(${values.map(() => '?').join(', ')})`, values)
}

export const insertInto = (table: string, row: Readonly<Record<string, unknown>>): Query =>
  join([raw(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES `), list(Object.values(row))], '')

export const insertIgnoringConflict = (
  dialect: Dialect,
  table: string,
  row: Readonly<Record<string, unknown>>,
): Query => {
  const insert = insertInto(table, row)
  return dialect === 'mysql'
    ? query(insert.text.replace(/^INSERT/, 'INSERT IGNORE'), insert.params)
    : query(`${insert.text} ON CONFLICT DO NOTHING`, insert.params)
}

export const containsIgnoringCase = (column: string, needle: string): Query =>
  query(`LOWER(${column}) LIKE ? ESCAPE '!'`, [`%${needle.toLowerCase().replace(/[!%_]/g, '!$&')}%`])

export const numberedPlaceholders = (text: string): string => {
  let index = 0
  return text.replace(/\?/g, () => `$${++index}`)
}

const QUERY = Symbol('Query')

const query = (text: string, params: ReadonlyArray<unknown>): Query => ({ [QUERY]: true, text, params }) as Query

const isQuery = (value: unknown): value is Query => typeof value === 'object' && value !== null && QUERY in value

const toFragment = (value: unknown): Query => (isQuery(value) ? value : query('?', [value]))

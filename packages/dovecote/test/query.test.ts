import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  containsIgnoringCase,
  insertIgnoringConflict,
  insertInto,
  join,
  list,
  numberedPlaceholders,
  raw,
  sql,
} from '../src/sql/query.ts'

describe('a query', () => {
  it('binds every interpolated value as a parameter, never as text', () => {
    const hostile = "x' OR '1'='1"
    const query = sql`SELECT * FROM notes WHERE id = ${hostile} AND sent_at < ${5}`
    expect(query.text).toBe('SELECT * FROM notes WHERE id = ? AND sent_at < ?')
    expect(query.params).toEqual([hostile, 5])
  })

  it('nests a query in place, keeping the order of its parameters', () => {
    const inner = sql`status = ${'sent'}`
    const outer = sql`SELECT 1 WHERE ${inner} AND id IN ${list(['a', 'b'])} AND x = ${1}`
    expect(outer.text).toBe('SELECT 1 WHERE status = ? AND id IN (?, ?) AND x = ?')
    expect(outer.params).toEqual(['sent', 'a', 'b', 1])
  })

  it('treats a plain object that looks like a query as a value', () => {
    const lookalike = { text: 'SELECT secret FROM credentials', params: [] }
    expect(sql`SELECT ${lookalike}`).toMatchObject({ text: 'SELECT ?', params: [lookalike] })
  })

  it('joins parts with a separator and takes raw text without parameters', () => {
    expect(join([raw('a'), sql`b = ${1}`], ' AND ')).toMatchObject({ text: 'a AND b = ?', params: [1] })
  })

  it('refuses an empty list, which SQL cannot express', () => {
    expect(() => list([])).toThrow(RangeError)
  })

  it('inserts a row, and ignores a conflicting one in each dialect’s words', () => {
    expect(insertInto('pickups', { note_id: 'n', picked_at: 1 })).toMatchObject({
      text: 'INSERT INTO pickups (note_id, picked_at) VALUES (?, ?)',
      params: ['n', 1],
    })
    expect(insertIgnoringConflict('mysql', 'pickups', { note_id: 'n' }).text).toBe(
      'INSERT IGNORE INTO pickups (note_id) VALUES (?)',
    )
    for (const dialect of ['sqlite', 'postgres'] as const)
      expect(insertIgnoringConflict(dialect, 'pickups', { note_id: 'n' }).text).toBe(
        'INSERT INTO pickups (note_id) VALUES (?) ON CONFLICT DO NOTHING',
      )
  })

  it('searches without case and escapes the wildcards a person typed', () => {
    expect(containsIgnoringCase('n.body', 'Ab%_!c')).toMatchObject({
      text: "LOWER(n.body) LIKE ? ESCAPE '!'",
      params: ['%ab!%!_!!c%'],
    })
  })

  it('numbers placeholders for PostgreSQL in the order they appear', () => {
    expect(numberedPlaceholders('a = ? AND b IN (?, ?)')).toBe('a = $1 AND b IN ($2, $3)')
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), (count) => {
        const text = numberedPlaceholders(Array.from({ length: count }, () => '?').join(','))
        expect(text.split(',').filter(Boolean)).toEqual(
          Array.from({ length: count }, (_, index) => `$${index + 1}`),
        )
      }),
    )
  })
})

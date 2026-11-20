import type { Schema as S } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { AgentReport, OrganizationInsights } from '../src/insights.ts'
import { MEASURES, type MeasureAudience, NOT_MEASURES, PERIOD_FIELDS } from '../src/measures.ts'

const RESPONSES: Readonly<Record<MeasureAudience, S.Ast>> = {
  you: AgentReport.ast,
  administrators: OrganizationInsights.ast,
}

describe('MEASURES', () => {
  it('names the path of every figure in a person’s own report as a measure the person sees', () => {
    expect(unnamed('you')).toEqual([])
  })

  it('names the path of every figure in the organization’s insights as a measure administrators see', () => {
    expect(unnamed('administrators')).toEqual([])
  })

  it('names no path that its response lacks, so the page never promises a figure that is not there', () => {
    for (const measure of MEASURES) {
      const paths = new Set(leafPaths(RESPONSES[measure.audience]))
      for (const field of measure.fields) expect(paths.has(field), field).toBe(true)
    }
  })

  it('keeps one measure per key and audience, and no measured path ending in a label or a setting', () => {
    const keys = MEASURES.map((measure) => `${measure.audience}.${measure.key}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const measure of MEASURES)
      for (const field of measure.fields)
        expect(NOT_MEASURES.includes(field.split('.').at(-1)!), field).toBe(false)
  })

  it('walks into records and arrays, and leaves out the period fields', () => {
    const ast: S.Ast = {
      type: 'struct',
      fields: {
        periods: {
          optional: false,
          ast: {
            type: 'array',
            items: {
              type: 'record',
              values: { type: 'struct', fields: { a: { optional: false, ast: { type: 'boolean' } } } },
            },
          },
        },
      },
    }
    expect(leafPaths(ast)).toEqual(['a'])
  })
})

const unnamed = (audience: MeasureAudience): string[] => {
  const named = new Set<string>(
    MEASURES.filter((measure) => measure.audience === audience).flatMap((measure) => measure.fields),
  )
  return [...new Set(leafPaths(RESPONSES[audience]))].filter(
    (path) => !named.has(path) && !NOT_MEASURES.includes(path.split('.').at(-1)!),
  )
}

/** Every field holding a value rather than more fields, by its names from the top, periods left out. */
const leafPaths = (ast: S.Ast, prefix: ReadonlyArray<string> = []): string[] => {
  switch (ast.type) {
    case 'struct':
      return Object.entries(ast.fields).flatMap(([name, field]) =>
        leafPaths(field.ast, PERIOD_FIELDS.includes(name) ? prefix : [...prefix, name]),
      )
    case 'array':
      return leafPaths(ast.items, prefix)
    case 'record':
      return leafPaths(ast.values, prefix)
    case 'union':
      return ast.members.filter((member) => !isNull(member)).flatMap((member) => leafPaths(member, prefix))
    case 'refined':
    case 'tolerant':
      return leafPaths(ast.inner, prefix)
    default:
      return [prefix.join('.')]
  }
}

const isNull = (ast: S.Ast): boolean =>
  ast.type === 'literal' && ast.values.length === 1 && ast.values[0] === null

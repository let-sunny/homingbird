import type { Schema as S } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { AgentReport, OrganizationInsights } from '../src/insights.ts'
import { MEASURES, type MeasureAudience, NOT_MEASURES } from '../src/measures.ts'

describe('MEASURES', () => {
  it('names every field of a person’s own report as a measure the person sees', () => {
    expect(unnamed(AgentReport.ast, 'you')).toEqual([])
  })

  it('names every field of the organization’s insights as a measure administrators see', () => {
    expect(unnamed(OrganizationInsights.ast, 'administrators')).toEqual([])
  })

  it('names no field that neither response has, so the page never promises a figure that is not there', () => {
    const fields = (audience: MeasureAudience) =>
      new Set(fieldNames(audience === 'you' ? AgentReport.ast : OrganizationInsights.ast))
    for (const measure of MEASURES)
      for (const field of measure.fields) expect(fields(measure.audience).has(field), field).toBe(true)
  })

  it('keeps one measure per key and audience, and nothing both a measure and not one', () => {
    const keys = MEASURES.map((measure) => `${measure.audience}.${measure.key}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const measure of MEASURES)
      for (const field of measure.fields) expect(NOT_MEASURES.includes(field), field).toBe(false)
  })
})

const unnamed = (ast: S.Ast, audience: MeasureAudience): string[] => {
  const named = new Set<string>(
    MEASURES.filter((measure) => measure.audience === audience).flatMap((measure) => measure.fields),
  )
  return [...new Set(fieldNames(ast))].filter((field) => !named.has(field) && !NOT_MEASURES.includes(field))
}

const fieldNames = (ast: S.Ast): string[] => {
  switch (ast.type) {
    case 'struct':
      return Object.entries(ast.fields).flatMap(([name, field]) => [name, ...fieldNames(field.ast)])
    case 'array':
      return fieldNames(ast.items)
    case 'union':
      return ast.members.flatMap(fieldNames)
    case 'refined':
    case 'tolerant':
      return fieldNames(ast.inner)
    default:
      return []
  }
}

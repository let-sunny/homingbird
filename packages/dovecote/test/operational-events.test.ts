import type { Schema as S } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { OPERATIONAL_EVENTS, type OperationalEventName } from '../src/log/operational-events.ts'

type Ast = S.Schema<unknown>['ast']

/** A free-form string attribute could carry a secret; every one is bounded or patterned. */
const isBounded = (ast: Ast): boolean =>
  ast.type === 'string'
    ? ast.maxLength !== undefined || ast.pattern !== undefined
    : ast.type === 'struct'
      ? Object.values(ast.fields).every((field) => isBounded(field.ast))
      : ast.type === 'union'
        ? ast.members.every(isBounded)
        : ast.type !== 'unknown'

describe('the operational event catalogue', () => {
  it('gives every line a level, a fixed sentence and bounded attributes', () => {
    for (const name of Object.keys(OPERATIONAL_EVENTS) as OperationalEventName[]) {
      const declared = OPERATIONAL_EVENTS[name]
      expect(['debug', 'info', 'warn', 'error']).toContain(declared.level)
      expect(declared.body).toMatch(/^[A-Z].+\.$/)
      expect([name, isBounded(declared.attributes.ast)]).toEqual([name, true])
    }
  })

  it('keeps the detail of a defect for debug lines only', () => {
    expect(OPERATIONAL_EVENTS['defect.detail'].level).toBe('debug')
    expect(isBounded({ type: 'string' })).toBe(false)
    expect(isBounded({ type: 'unknown' })).toBe(false)
  })
})

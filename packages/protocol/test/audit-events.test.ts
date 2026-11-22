import type { Schema as S } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  AUDIT_EVENTS,
  AUDIT_EVENT_NAMES,
  AUDIT_TIERS,
  CARRIES_CLIENT_ADDRESS,
  isAuditEventName,
  isKeptAt,
} from '../src/audit-events.ts'

type Ast = S.Schema<unknown>['ast']

/** Ids, enums, booleans, numbers and short strings only: nothing that can carry a note or a secret. */
const isMetadataOnly = (ast: Ast): boolean => {
  switch (ast.type) {
    case 'string':
      return ast.pattern !== undefined || (ast.maxLength !== undefined && ast.maxLength <= 253)
    case 'number':
    case 'boolean':
    case 'literal':
      return true
    case 'array':
      return ast.maxItems !== undefined && isMetadataOnly(ast.items)
    case 'record':
      return ast.values.type === 'boolean'
    case 'struct':
      return Object.values(ast.fields).every((field) => isMetadataOnly(field.ast))
    case 'union':
      return ast.members.every(isMetadataOnly)
    case 'tolerant':
      return isMetadataOnly(ast.inner)
    default:
      return false
  }
}

describe('the audit event catalogue', () => {
  it('declares every detail with ids, enums, numbers and bounded words only', () => {
    for (const name of AUDIT_EVENT_NAMES)
      expect([name, isMetadataOnly(AUDIT_EVENTS[name].detail.ast)]).toEqual([name, true])
  })

  it('knows a free-text field when it sees one', () => {
    expect(isMetadataOnly({ type: 'string' })).toBe(false)
    expect(isMetadataOnly({ type: 'unknown' })).toBe(false)
    expect(isMetadataOnly({ type: 'array', items: { type: 'boolean' } })).toBe(false)
    expect(isMetadataOnly({ type: 'record', values: { type: 'string', maxLength: 10 } })).toBe(false)
  })

  it('round-trips every detail and drops any key the catalogue does not declare', () => {
    for (const name of AUDIT_EVENT_NAMES) {
      const schema = AUDIT_EVENTS[name].detail as S.Schema<Record<string, unknown>>
      fc.assert(
        fc.property(arbitrary(schema), fc.string({ maxLength: 40 }), (detail, smuggled) => {
          const decoded = schema.decode({ ...detail, body: smuggled, token: smuggled })
          expect(decoded).toEqual({ _tag: 'Ok', value: detail })
        }),
        { numRuns: 20 },
      )
    }
  })

  it('keeps security events at both tiers and the rest only in full, what an operator exported or erased, who is in a group, which channel agents exist among them and where a cloud desk is woken, and how Slack is connected and linked', () => {
    expect(AUDIT_TIERS).toEqual(['security', 'full'])
    expect(isKeptAt('security', 'authz.denied')).toBe(true)
    expect(isKeptAt('security', 'note.approved')).toBe(false)
    expect(isKeptAt('full', 'note.approved')).toBe(true)
    expect(AUDIT_EVENT_NAMES.filter((name) => AUDIT_EVENTS[name].tier === 'security').sort()).toEqual(
      AUDIT_EVENT_NAMES.filter((name) =>
        /^(authn|authz|credential|oauth|organization|audit|system)\.|^member\.(access|invite_)|^note\.(exported|unsent_erased|retention_purged)$|^group\.members_changed$|^channel\.agent_(created|retired)$|^desk_wake\.|^slack\./.test(
          name,
        ),
      ).sort(),
    )
  })

  it('keeps a client address only on authentication and credential issuance', () => {
    expect(CARRIES_CLIENT_ADDRESS.every((name) => /^authn\.|^credential\.issued$/.test(name))).toBe(true)
  })

  it('records a group’s members as the difference, and a deactivation as its reason', () => {
    const detail = AUDIT_EVENTS['group.members_changed'].detail
    const ana = 'mem_ana000000000'
    expect(detail.decode({ added: [ana], removed: [] })._tag).toBe('Ok')
    expect(detail.decode({ added: [], removed: [ana], because: 'deactivated' })._tag).toBe('Ok')
    expect(detail.decode({ added: [], removed: [ana], because: 'bored' })._tag).toBe('Err')
    expect(AUDIT_EVENTS['group.created'].target).toBe('group')
  })

  it('tells a catalogue name from anything else', () => {
    expect(isAuditEventName('note.approved')).toBe(true)
    expect(isAuditEventName('drafts.send')).toBe(false)
    expect(isAuditEventName('toString')).toBe(false)
  })
})

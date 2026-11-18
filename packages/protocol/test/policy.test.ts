import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type Access, type MessagingFacts, allows, canMessage, relation } from '../src/policy.ts'

const facts: fc.Arbitrary<MessagingFacts> = fc.record({
  mode: fc.constantFrom('open', 'contacts'),
  isSelf: fc.boolean(),
  recipientStatus: fc.constantFrom('active', 'deactivated'),
  blocked: fc.boolean(),
  contact: fc.boolean(),
})

const open: MessagingFacts = {
  mode: 'open',
  isSelf: false,
  recipientStatus: 'active',
  blocked: false,
  contact: false,
}

describe('canMessage', () => {
  it('lets anyone message anyone active in open mode', () => {
    expect(canMessage(open)).toBe(true)
  })

  it('needs an accepted contact in contacts mode', () => {
    expect(canMessage({ ...open, mode: 'contacts' })).toBe(false)
    expect(canMessage({ ...open, mode: 'contacts', contact: true })).toBe(true)
  })

  it('is always refused by a block, by self, and by a deactivated recipient', () => {
    fc.assert(
      fc.property(facts, (f) => {
        if (f.blocked || f.isSelf || f.recipientStatus !== 'active') expect(canMessage(f)).toBe(false)
      }),
    )
  })

  it('matches the rule exactly over the whole truth table', () => {
    fc.assert(
      fc.property(facts, (f) => {
        const expected =
          !f.isSelf && f.recipientStatus === 'active' && !f.blocked && (f.mode === 'open' || f.contact)
        expect(canMessage(f)).toBe(expected)
      }),
    )
  })

  it('never lets a contact widen what a block forbids', () => {
    fc.assert(
      fc.property(facts, (f) => {
        expect(canMessage({ ...f, blocked: true, contact: true })).toBe(false)
      }),
    )
  })
})

describe('relation', () => {
  it.each([
    [{ isSelf: true, blockedByViewer: true, contact: 'accepted' }, 'self'],
    [{ isSelf: false, blockedByViewer: true, contact: 'accepted' }, 'blocked'],
    [{ isSelf: false, blockedByViewer: false, contact: 'accepted' }, 'contact'],
    [{ isSelf: false, blockedByViewer: false, contact: 'request_sent' }, 'request_sent'],
    [{ isSelf: false, blockedByViewer: false, contact: 'request_received' }, 'request_received'],
    [{ isSelf: false, blockedByViewer: false, contact: null }, 'none'],
  ] as const)('reads %j as %s', (input, expected) => {
    expect(relation(input)).toBe(expected)
  })
})

describe('allows', () => {
  const callers = [
    null,
    { kind: 'human', role: 'member' },
    { kind: 'human', role: 'admin' },
    { kind: 'agent', role: 'member' },
    { kind: 'agent', role: 'admin' },
  ] as const
  const table: Record<Access, boolean[]> = {
    public: [true, true, true, true, true],
    member: [false, true, true, true, true],
    human: [false, true, true, false, false],
    admin: [false, false, true, false, false],
  }

  it.each(Object.entries(table))('gates %s access', (access, expected) => {
    expect(callers.map((caller) => allows(access as Access, caller))).toEqual(expected)
  })

  it('never grants an agent credential human or admin access, even for an admin member', () => {
    for (const role of ['member', 'admin'] as const)
      for (const access of ['human', 'admin'] as const)
        expect(allows(access, { kind: 'agent', role })).toBe(false)
  })
})

import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { INVITE_LIFETIME_SECONDS, Invite, InviteEmail, InviteLink } from '../src/invites.ts'

describe('invites', () => {
  it('last seven days', () => {
    expect(INVITE_LIFETIME_SECONDS).toBe(604_800)
  })

  it.each([
    ['an invite', Invite],
    ['an invite link', InviteLink],
  ] as const)('round-trips %s generated from its schema', (_, schema) => {
    fc.assert(
      fc.property(arbitrary(schema as never), (value) => {
        expect(schema.decode(value)).toEqual({ _tag: 'Ok', value })
      }),
      { numRuns: 50 },
    )
  })

  it.each([
    ['friend@gmail.com', true],
    ['a@b', true],
    ['no-at-sign', false],
    ['two@@signs', false],
    ['spaced out@example.com', false],
    ['@example.com', false],
    ['friend@', false],
    [`${'a'.repeat(315)}@b.co`, true],
    [`${'a'.repeat(316)}@b.co`, false],
  ])('reads %s as an address to bind: %s', (email, accepted) => {
    expect(InviteEmail.decode(email)._tag).toBe(accepted ? 'Ok' : 'Err')
  })
})

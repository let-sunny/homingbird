import type { Member } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { type Caller, isHuman, viewerOf } from '../src/environment.ts'

const administrator = { id: 'mem_admin', name: 'Ana', role: 'admin' } as unknown as Member

const signedIn = (kind: 'human' | 'agent'): Caller => ({
  member: administrator,
  credential: { id: `cred_${kind}` as Caller['credential']['id'], kind, name: kind },
})

describe('a caller', () => {
  it('is a person only with a human credential', () => {
    expect(isHuman(signedIn('human'))).toBe(true)
    expect(isHuman(signedIn('agent'))).toBe(false)
  })

  it('keeps an administrator’s role for their own sign-in and reads as a member through their agent', () => {
    expect(viewerOf(signedIn('human')).role).toBe('admin')
    expect(viewerOf(signedIn('agent'))).toEqual({ ...administrator, role: 'member' })
    expect(administrator.role).toBe('admin')
  })
})

import type { Schema as S } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as shared from '../src/contract-schemas.ts'
import { refinements } from './contract-refinements.ts'

describe('shared contract schemas', () => {
  it('accepts page sizes and cursors made of digits only', () => {
    expect(shared.PageLimit.is('50')).toBe(true)
    expect(shared.PageLimit.is('5000')).toBe(false)
    expect(shared.PageLimit.is('-1')).toBe(false)
    expect(shared.Digits.is('1700000000000')).toBe(true)
    expect(shared.Digits.is('1e3')).toBe(false)
    expect(shared.Empty.decode({ extra: 1 })).toMatchObject({ _tag: 'Ok', value: {} })
  })

  it('needs between one and fifty recipients', () => {
    const id = 'mem_abcdefghijkl'
    expect(shared.Recipients.is([])).toBe(false)
    expect(shared.Recipients.is([id])).toBe(true)
    expect(shared.RECIPIENTS_MAX).toBe(50)
    expect(shared.Recipients.is(Array.from({ length: 50 }, () => id))).toBe(true)
    expect(shared.Recipients.is(Array.from({ length: 51 }, () => id))).toBe(false)
  })

  it.each(['InboxItem', 'DeviceRequest', 'ConsentRequest', 'ServerInfo', 'Me'] as const)(
    '%s accepts its generated values',
    (name) => {
      const schema = shared[name] as S.Schema<unknown>
      fc.assert(
        fc.property(arbitrary(schema, refinements), (value) => {
          expect(schema.is(JSON.parse(JSON.stringify(value)))).toBe(true)
        }),
        { numRuns: 20 },
      )
    },
  )
})

describe('server info', () => {
  const INFO = {
    name: 'dovecote',
    version: '1.2.0',
    contactMode: 'open',
    signInWith: 'Google',
    protocolVersion: 3,
  }

  it('reads a server that names itself differently as unknown, but refuses to decode it', () => {
    expect(shared.ServerInfo.read({ ...INFO, name: 'pigeonhole' })).toMatchObject({
      _tag: 'Ok',
      value: { name: 'unknown' },
    })
    expect(shared.ServerInfo.decode({ ...INFO, name: 'pigeonhole' })._tag).toBe('Err')
  })

  it('takes a server that states no protocol version for version 1', () => {
    const { protocolVersion: _, ...older } = INFO
    expect(shared.ServerInfo.read(older)).toMatchObject({ _tag: 'Ok', value: { protocolVersion: 1 } })
    expect(shared.ServerInfo.read(INFO)).toMatchObject({ _tag: 'Ok', value: { protocolVersion: 3 } })
    expect(shared.ServerInfo.is({ ...INFO, protocolVersion: -1 })).toBe(false)
  })

  it('offers features as a map of switches', () => {
    expect(shared.ServerInfo.is({ ...INFO, features: { debates: true, insights: false } })).toBe(true)
    expect(shared.ServerInfo.is({ ...INFO, features: { debates: 'yes' } })).toBe(false)
  })
})

describe('device and consent requests', () => {
  it('need an expiry that is a whole, non-negative time', () => {
    const device = { userCode: 'BCDF-GHJK', client: 'Cursor', expiresAt: 1_700_000_000_000 }
    expect(shared.DeviceRequest.is(device)).toBe(true)
    expect(shared.DeviceRequest.is({ ...device, expiresAt: -1 })).toBe(false)
    expect(shared.DeviceRequest.is({ ...device, expiresAt: 1.5 })).toBe(false)
    const consent = { id: 'c1', client: 'Cursor', redirectHost: 'localhost', expiresAt: 0 }
    expect(shared.ConsentRequest.is(consent)).toBe(true)
    expect(shared.ConsentRequest.is({ ...consent, redirectHost: undefined })).toBe(false)
  })
})

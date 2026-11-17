import { describe, expect, it } from 'vitest'
import {
  HANDSHAKE_REVISIONS,
  PROTOCOL_VERSION_META_KEY,
  STATELESS_REVISIONS,
  SUPPORTED_REVISIONS,
  claimedRevision,
  handshakeRevisionFor,
  isStateless,
} from '../src/revisions.ts'

describe('revisions', () => {
  it('supports the stateless revision and every handshake revision', () => {
    expect(SUPPORTED_REVISIONS).toEqual([
      '2026-07-28',
      '2025-11-25',
      '2025-06-18',
      '2025-03-26',
      '2024-11-05',
    ])
    expect(SUPPORTED_REVISIONS).toEqual([...STATELESS_REVISIONS, ...HANDSHAKE_REVISIONS])
  })

  it.each(HANDSHAKE_REVISIONS)(
    'agrees to the handshake revision %s when the client asks for it',
    (revision) => {
      expect(handshakeRevisionFor(revision)).toBe(revision)
    },
  )

  it.each([['1999-01-01'], ['2026-07-28'], [undefined], [20251125]])(
    'offers the newest handshake revision when the client asks for %s',
    (requested) => {
      expect(handshakeRevisionFor(requested)).toBe('2025-11-25')
    },
  )

  it('reads the revision a request claims in its metadata', () => {
    expect(claimedRevision({ _meta: { [PROTOCOL_VERSION_META_KEY]: '2026-07-28' } })).toBe('2026-07-28')
    expect(claimedRevision({ _meta: { [PROTOCOL_VERSION_META_KEY]: 5 } })).toBe('5')
  })

  it.each([[{}], [{ _meta: null }], [{ _meta: 'x' }], [{ _meta: {} }]])('finds no claim in %j', (params) => {
    expect(claimedRevision(params)).toBeNull()
  })

  it('tells stateless revisions from handshake ones', () => {
    expect(isStateless('2026-07-28')).toBe(true)
    expect(isStateless('2025-11-25')).toBe(false)
    expect(isStateless(null)).toBe(false)
  })
})

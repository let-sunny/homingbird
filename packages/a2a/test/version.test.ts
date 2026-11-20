import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CURRENT, LEGACY } from '../src/dialect.ts'
import { SUPPORTED, requestedVersionOf } from '../src/version.ts'

describe('requestedVersionOf', () => {
  it.each([undefined, '', '   '])('reads %j as no version stated', (header) => {
    expect(requestedVersionOf(header)).toEqual({ kind: 'unstated' })
  })

  it.each([
    ['1.0', CURRENT],
    ['1.0.0', CURRENT],
    [' 1.0.1 ', CURRENT],
    ['0.3', LEGACY],
    ['0.3.0', LEGACY],
  ])('reads %j as a supported dialect, ignoring the patch number', (header, dialect) => {
    expect(requestedVersionOf(header)).toEqual({ kind: 'supported', dialect })
  })

  it.each(['2.0', '1.1', '1', '0.2', '1.0.x', '1.0.', '1.0.0.0', '10.0', 'v1.0', '1x0'])(
    'reads %j as unsupported',
    (header) => {
      expect(requestedVersionOf(header)).toEqual({ kind: 'unsupported', version: header })
    },
  )

  it('supports exactly the versions the dialects speak', () => {
    expect(SUPPORTED.map((dialect) => dialect.version)).toEqual(['1.0', '0.3'])
  })

  it('never reads a version outside 1.0 and 0.3 as supported', () => {
    fc.assert(
      fc.property(fc.string(), (header) => {
        const requested = requestedVersionOf(header)
        if (requested.kind !== 'supported') return
        expect(header.trim()).toMatch(/^(1\.0|0\.3)(\.\d+)?$/)
      }),
    )
  })
})

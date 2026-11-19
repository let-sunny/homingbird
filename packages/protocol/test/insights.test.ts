import type { Schema as S } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AgentReport, OrganizationInsights, PlaceName, TrustVerdict } from '../src/insights.ts'

const roundTrips = <A>(schema: S.Schema<A>): void =>
  fc.assert(
    fc.property(arbitrary(schema), (value) => {
      expect(schema.decode(JSON.parse(JSON.stringify(value)))).toEqual({ _tag: 'Ok', value })
    }),
    { numRuns: 20 },
  )

describe('insights on the wire', () => {
  it('round-trips every agent report and every organization summary through JSON', () => {
    roundTrips(AgentReport)
    roundTrips(OrganizationInsights)
  })

  it('names a verdict in words, never as a number', () => {
    expect(TrustVerdict.decode('usually_as_written')._tag).toBe('Ok')
    expect(TrustVerdict.decode(0.8)._tag).toBe('Err')
  })

  it('names a channel, or null for direct messages, and nothing empty', () => {
    expect(PlaceName.decode(null)._tag).toBe('Ok')
    expect(PlaceName.decode('billing')._tag).toBe('Ok')
    expect(PlaceName.decode('')._tag).toBe('Err')
  })

  it('keeps an organization period empty when too few people were active', () => {
    const summary = {
      generatedAt: 1,
      quickApprovalSeconds: 3,
      minimumGroupSize: 5,
      blocks: null,
      periods: [{ days: 7, current: null, previous: null }],
    }
    expect(OrganizationInsights.decode(summary)._tag).toBe('Ok')
  })
})

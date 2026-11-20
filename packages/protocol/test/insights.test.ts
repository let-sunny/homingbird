import type { Schema as S } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  AgentReport,
  OrganizationFigures,
  OrganizationInsights,
  PICKUP_WAIT_MS,
  PlaceName,
  QUICK_APPROVAL_SHARE,
  QUICK_PICKUP_MS,
  QUICK_WARNING_MINIMUM_AS_WRITTEN,
  QUICK_WARNING_WEEKS,
  TrustVerdict,
} from '../src/insights.ts'

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

  it('reads a report from a server without the newer figures', () => {
    const figures = {
      activeMembers: 5,
      notesSent: 9,
      newNotes: 4,
      answered: 3,
      medianFirstReplyMs: null,
      agentDraftsWritten: 0,
      sentAsWritten: null,
      sentAfterEdits: null,
      discarded: null,
      quickApprovals: null,
      skipped: 0,
      places: [],
      hiddenPlaces: 0,
      byClient: [],
      byModel: [],
      hiddenLabels: 0,
    }
    expect(OrganizationFigures.decode(figures)._tag).toBe('Ok')
    expect(OrganizationFigures.decode({ ...figures, delivery: null, authorship: null })._tag).toBe('Ok')
  })

  it('keeps the quick-approval warning stricter than one busy week', () => {
    expect(QUICK_APPROVAL_SHARE).toBe(0.25)
    expect(QUICK_WARNING_WEEKS).toBe(2)
    expect(QUICK_WARNING_MINIMUM_AS_WRITTEN).toBe(10)
    expect(QUICK_PICKUP_MS).toBe(300_000)
    expect(PICKUP_WAIT_MS).toBe(86_400_000)
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

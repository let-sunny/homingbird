import type { Schema as S } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_EVENTS,
  AnalyticsBatch,
  type AnalyticsEventName,
  analyticsEvent,
  checkAnalyticsEvent,
} from '../src/analytics.ts'

const NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[]

describe('the product analytics catalogue', () => {
  it('accepts every event it declares, with the properties it declares', () => {
    for (const name of NAMES)
      fc.assert(
        fc.property(arbitrary(ANALYTICS_EVENTS[name] as S.Schema<unknown>), (properties) => {
          expect(checkAnalyticsEvent(analyticsEvent(name, properties as never, 'anon-0001', 1))).toBeNull()
        }),
        { numRuns: 20 },
      )
  })

  it('refuses an event it does not know, a property it does not declare, and a value out of range', () => {
    expect(
      checkAnalyticsEvent({ event: 'note_sent', properties: {}, anonymousId: 'anon-0001', timestamp: 1 }),
    ).toBe('"note_sent" is not in the analytics catalogue')
    expect(
      checkAnalyticsEvent({
        event: 'page_viewed',
        properties: { page: 'home', email: 'ana@example.com' },
        anonymousId: 'anon-0001',
        timestamp: 1,
      }),
    ).toBe('"page_viewed" does not carry "email"')
    expect(
      checkAnalyticsEvent({
        event: 'debate_opened',
        properties: { visibility: 'secret' },
        anonymousId: 'anon-0001',
        timestamp: 1,
      }),
    ).toMatch(/^"debate_opened": visibility/)
  })

  it('carries no free text: every property is an enum or a short pattern', () => {
    for (const name of NAMES)
      for (const field of Object.values(
        ANALYTICS_EVENTS[name].ast.type === 'struct' ? ANALYTICS_EVENTS[name].ast.fields : {},
      ))
        expect(
          field.ast.type === 'literal' ||
            (field.ast.type === 'tolerant' && field.ast.inner.type === 'literal') ||
            (field.ast.type === 'string' && field.ast.pattern !== undefined),
        ).toBe(true)
  })

  it('sends Segment-shaped batches of one to twenty events', () => {
    const event = analyticsEvent('sign_in_completed', { client: 'web' }, 'anon-0001', 1)
    expect(AnalyticsBatch.is({ events: [event] })).toBe(true)
    expect(AnalyticsBatch.is({ events: [] })).toBe(false)
    expect(AnalyticsBatch.is({ events: Array(21).fill(event) })).toBe(false)
    expect(AnalyticsBatch.is({ events: [{ ...event, anonymousId: 'ana@example.com' }] })).toBe(false)
  })
})

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  PILOT_SIZE,
  isSlow,
  measurementTable,
  planChannels,
  planExchanges,
  seededRandom,
  summarize,
} from '../pilot-measure.ts'

describe('the pilot measurement', () => {
  it('draws the same numbers from the same seed, and numbers between 0 and 1', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const first = seededRandom(seed)
        const second = seededRandom(seed)
        const draws = Array.from({ length: 20 }, () => first())
        expect(draws).toEqual(Array.from({ length: 20 }, () => second()))
        expect(draws.every((draw) => draw >= 0 && draw < 1)).toBe(true)
      }),
    )
  })

  it('puts every member in the chosen number of channels, with answerers who are members', () => {
    const channels = planChannels(PILOT_SIZE, seededRandom(7))
    expect(channels).toHaveLength(PILOT_SIZE.channels)
    for (let member = 0; member < PILOT_SIZE.members; member++)
      expect(channels.filter((room) => room.members.includes(member))).toHaveLength(
        PILOT_SIZE.channelsPerMember,
      )
    for (const room of channels) {
      expect(room.answerers.every((answerer) => room.members.includes(answerer))).toBe(true)
      expect(room.answerers.length).toBe(Math.min(PILOT_SIZE.answerersPerChannel, room.members.length))
    }
  })

  it('plans a month of exchanges, half the day’s notes each, never asking oneself', () => {
    const channels = planChannels(PILOT_SIZE, seededRandom(7))
    const exchanges = planExchanges(PILOT_SIZE, channels, seededRandom(8))
    expect(exchanges).toHaveLength((PILOT_SIZE.days * PILOT_SIZE.notesPerDay) / 2)
    for (const exchange of exchanges) {
      expect(exchange.answerer).not.toBe(exchange.asker)
      expect(exchange.minute).toBeGreaterThanOrEqual(8 * 60)
      expect(exchange.minute).toBeLessThan(18 * 60)
      if (exchange.channel !== null) {
        expect(channels[exchange.channel]!.members).toContain(exchange.asker)
        expect(channels[exchange.channel]!.answerers).toContain(exchange.answerer)
      }
    }
    const byAgent = exchanges.filter((exchange) => exchange.draftedByAgent).length / exchanges.length
    expect(byAgent).toBeGreaterThan(0.7)
    expect(byAgent).toBeLessThan(0.9)
    expect(new Set(exchanges.map((exchange) => exchange.question))).toEqual(
      new Set(['as_written', 'edited', 'discarded']),
    )
  })

  it('summarizes durations by median, 95th percentile and maximum', () => {
    expect(summarize([])).toEqual({ runs: 0, medianMs: 0, p95Ms: 0, maxMs: 0 })
    expect(summarize([5, 1, 3])).toEqual({ runs: 3, medianMs: 3, p95Ms: 5, maxMs: 5 })
    const hundred = Array.from({ length: 100 }, (_, index) => index + 1)
    expect(summarize(hundred)).toMatchObject({ medianMs: 50, p95Ms: 95, maxMs: 100 })
    expect(summarize([1.234])).toMatchObject({ medianMs: 1.2 })
  })

  it('calls a figure slow only when its 95th percentile passes half a second', () => {
    expect(isSlow(summarize([10, 500]))).toBe(false)
    expect(isSlow(summarize([10, 501]))).toBe(true)
  })

  it('writes the table the deployment guide keeps', () => {
    expect(measurementTable([{ what: 'Organization insights', ...summarize([2, 4]) }])).toBe(
      [
        '| What | Runs | Median | p95 | Max |',
        '| --- | --- | --- | --- | --- |',
        '| Organization insights | 2 | 2 ms | 4 ms | 4 ms |',
      ].join('\n'),
    )
  })
})

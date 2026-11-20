import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  PILOT_SIZE,
  TEAM_SIZE,
  isSlow,
  measureTeams,
  measurementTable,
  mostTeamsShown,
  planChannels,
  planExchanges,
  planTeams,
  seededRandom,
  summarize,
  teamTable,
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

describe('the team measurement', () => {
  it('draws each team between the smallest and largest size, of distinct members of the organization', () => {
    fc.assert(
      fc.property(fc.integer(), fc.boolean(), (seed, primary) => {
        const teams = planTeams(TEAM_SIZE, seededRandom(seed), primary)
        expect(teams).toHaveLength(TEAM_SIZE.teams)
        for (const team of teams) {
          expect(new Set(team).size).toBe(team.length)
          expect(team.every((member) => member >= 0 && member < TEAM_SIZE.members)).toBe(true)
          expect(team.length).toBeLessThanOrEqual(TEAM_SIZE.largestTeam)
          if (!primary) expect(team.length).toBeGreaterThanOrEqual(TEAM_SIZE.smallestTeam)
        }
      }),
    )
  })

  it('puts every person in one primary team at most', () => {
    const teams = planTeams(TEAM_SIZE, seededRandom(7), true)
    const memberships = teams.flat()
    expect(new Set(memberships).size).toBe(memberships.length)
  })

  it('stops filling primary teams once everyone has one', () => {
    const teams = planTeams({ ...TEAM_SIZE, members: 10 }, seededRandom(7), true)
    expect(teams.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, member) => member))
  })

  it('never shows more teams than the best choice, nor more than are large enough', () => {
    const seeds = [1, 2, 3, 4, 5]
    for (const primary of [false, true]) {
      const measured = measureTeams(TEAM_SIZE, seeds, primary)
      expect(measured.shown).toHaveLength(seeds.length)
      seeds.forEach((_, index) => {
        expect(measured.shown[index]!).toBeLessThanOrEqual(measured.atBest[index]!)
        expect(measured.atBest[index]!).toBeLessThanOrEqual(measured.largeEnough[index]!)
      })
    }
  })

  it('finds the most teams the cell rule allows', () => {
    const size = { ...TEAM_SIZE, members: 15, minimum: 5 }
    const apart = [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
    ]
    expect(mostTeamsShown(apart, size)).toBe(2)
    expect(mostTeamsShown([...apart, [0, 1, 2, 3, 5]], size)).toBe(2)
    expect(mostTeamsShown([[0, 1, 2]], size)).toBe(0)
    expect(mostTeamsShown([[...Array.from({ length: 12 }, (_, member) => member)]], size)).toBe(0)
  })

  it('tables how many organizations showed each number of teams', () => {
    expect(teamTable({ shown: [1, 1, 2] }, 2)).toBe(
      ['| Teams shown | Organizations |', '| --- | --- |', '| 0 | 0 |', '| 1 | 2 |', '| 2 | 1 |'].join('\n'),
    )
  })
})

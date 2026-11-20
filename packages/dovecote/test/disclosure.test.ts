import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type Contribution, cellOf, placesShown, teamsShown } from '../src/domain/disclosure.ts'

const people = (count: number, prefix = 'm'): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`)

const member = (person: string, ...teams: string[]): Contribution => ({ person, teams })

const contributionsArbitrary = fc.array(
  fc.record({
    person: fc.constantFrom(...people(24)),
    teams: fc.uniqueArray(fc.constantFrom('a', 'b', 'c', 'd', 'e'), { maxLength: 3 }),
  }),
  { maxLength: 60 },
)

/**
 * The people a combination of shown team totals and the organization's total gives away: the totals
 * weigh each contribution by the teams it counts for, and when every weight is 0 or 1 the combination
 * is exactly the sum over the contributions weighing 1.
 */
const isolatedBy = (
  contributions: ReadonlyArray<Contribution>,
  shown: ReadonlyArray<string>,
  weights: ReadonlyArray<number>,
): ReadonlySet<string> | null => {
  const [organization, ...teamWeights] = weights
  const weighed = contributions.map((contribution) => ({
    person: contribution.person,
    weight:
      organization! +
      shown.reduce(
        (sum, team, index) => sum + (new Set(contribution.teams).has(team) ? teamWeights[index]! : 0),
        0,
      ),
  }))
  if (weighed.some((each) => each.weight !== 0 && each.weight !== 1)) return null
  return new Set(weighed.filter((each) => each.weight === 1).map((each) => each.person))
}

const combinations = (length: number): number[][] =>
  length === 0
    ? [[]]
    : combinations(length - 1).flatMap((rest) => [-1, 0, 1].map((weight) => [weight, ...rest]))

describe('teamsShown', () => {
  it('shows teams that do not overlap when each has the minimum', () => {
    const contributions = [
      ...people(5, 'a').map((person) => member(person, 'design')),
      ...people(6, 'b').map((person) => member(person, 'billing')),
      ...people(5, 'n').map((person) => member(person)),
    ]
    expect(teamsShown(contributions, 5)).toEqual({ shown: ['billing', 'design'], hidden: [] })
  })

  it('hides a team under the minimum on its own', () => {
    const contributions = [
      ...people(6, 'a').map((person) => member(person, 'design')),
      ...people(4, 'b').map((person) => member(person, 'billing')),
      ...people(5, 'n').map((person) => member(person)),
    ]
    expect(teamsShown(contributions, 5)).toEqual({ shown: ['design'], hidden: ['billing'] })
  })

  it('hides the smaller of two teams whose overlap is a cell of fewer than the minimum', () => {
    const contributions = [
      ...people(6, 'a').map((person) => member(person, 'design')),
      ...people(7, 'b').map((person) => member(person, 'billing')),
      member('both', 'design', 'billing'),
      ...people(5, 'n').map((person) => member(person)),
    ]
    expect(teamsShown(contributions, 5)).toEqual({ shown: ['billing'], hidden: ['design'] })
  })

  it('hides the smallest team when too few people are in no shown team', () => {
    const contributions = [
      ...people(6, 'a').map((person) => member(person, 'design')),
      ...people(7, 'b').map((person) => member(person, 'billing')),
      ...people(2, 'n').map((person) => member(person)),
    ]
    expect(teamsShown(contributions, 5)).toEqual({ shown: ['billing'], hidden: ['design'] })
  })

  it('shows a team that covers everyone, since nobody is left outside it', () => {
    const contributions = people(5).map((person) => member(person, 'everyone'))
    expect(teamsShown(contributions, 5)).toEqual({ shown: ['everyone'], hidden: [] })
  })

  it('counts a person once per cell, however much they contributed', () => {
    const contributions = [
      ...people(5, 'a').map((person) => member(person, 'design')),
      ...Array.from({ length: 10 }, () => member('busy', 'billing')),
      ...people(5, 'n').map((person) => member(person)),
    ]
    expect(teamsShown(contributions, 5)).toEqual({ shown: ['design'], hidden: ['billing'] })
  })

  it('places a person who moved teams in the cell of each contribution', () => {
    const contributions = [
      ...people(5, 'a').map((person) => member(person, 'design')),
      ...people(5, 'n').map((person) => member(person)),
      member('mover', 'design'),
      member('mover'),
    ]
    expect(teamsShown(contributions, 5).shown).toEqual(['design'])
    expect(cellOf(member('mover', 'design', 'design', 'billing'), new Set(['design']))).toEqual(['design'])
  })

  it('never lets a sum or difference of shown totals give away fewer than the minimum', () => {
    fc.assert(
      fc.property(contributionsArbitrary, fc.integer({ min: 2, max: 6 }), (contributions, minimum) => {
        fc.pre(new Set(contributions.map((contribution) => contribution.person)).size >= minimum)
        const { shown } = teamsShown(contributions, minimum)
        for (const weights of combinations(shown.length + 1)) {
          const isolated = isolatedBy(contributions, shown, weights)
          if (isolated === null || isolated.size === 0) continue
          expect(isolated.size).toBeGreaterThanOrEqual(minimum)
        }
      }),
    )
  })

  it('leaves every cell of shown teams empty or with the minimum, and names every team once', () => {
    fc.assert(
      fc.property(contributionsArbitrary, fc.integer({ min: 2, max: 6 }), (contributions, minimum) => {
        const { shown, hidden } = teamsShown(contributions, minimum)
        const teams = new Set(contributions.flatMap((contribution) => contribution.teams))
        expect([...shown, ...hidden].sort()).toEqual([...teams].sort())
        const cells = Map.groupBy(contributions, (contribution) =>
          JSON.stringify(cellOf(contribution, new Set(shown))),
        )
        if (shown.length > 0)
          for (const cell of cells.values())
            expect(new Set(cell.map((contribution) => contribution.person)).size).toBeGreaterThanOrEqual(
              minimum,
            )
      }),
    )
  })

  it('keeps every team that no small cell borders', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 2, max: 6 }), (teams, minimum) => {
        const contributions = [
          ...Array.from({ length: teams }, (_, team) =>
            people(minimum, `t${team}-`).map((person) => member(person, `team${team}`)),
          ).flat(),
          ...people(minimum, 'n').map((person) => member(person)),
        ]
        expect(teamsShown(contributions, minimum).shown).toHaveLength(teams)
      }),
    )
  })
})

describe('placesShown', () => {
  const group = (place: string | null, members: ReadonlyArray<string>) => ({
    place,
    people: new Set(members),
  })

  it('shows every group of at least the minimum and hides the smaller ones', () => {
    const shown = placesShown(
      [
        group('billing', people(6, 'b')),
        group(null, people(5, 'd')),
        group('payroll', people(2, 'p')),
        group('security', people(3, 's')),
      ],
      5,
    )
    expect(shown).toEqual({ shown: ['billing', null], hidden: ['payroll', 'security'] })
  })

  it('hides one more group for a hidden group nobody is known in, since the remainder still gives its count', () => {
    const shown = placesShown(
      [group('billing', people(9, 'b')), group('deploys', people(6, 'd')), group('gone', [])],
      5,
    )
    expect(shown).toEqual({ shown: ['billing'], hidden: ['gone', 'deploys'] })
  })

  it('hides one more group when the hidden ones together are still too few, so no remainder gives one away', () => {
    const shown = placesShown(
      [group('billing', people(9, 'b')), group('deploys', people(6, 'd')), group('payroll', people(2, 'p'))],
      5,
    )
    expect(shown).toEqual({ shown: ['billing'], hidden: ['payroll', 'deploys'] })
  })

  it('leaves the hidden groups together either empty or at least the minimum, whatever the groups are', () => {
    const groups = fc.array(
      fc.record({
        place: fc.option(fc.string({ minLength: 1, maxLength: 3 })),
        people: fc
          .uniqueArray(fc.constantFrom(...people(14)), { maxLength: 12 })
          .map((each) => new Set(each)),
      }),
      { maxLength: 8 },
    )
    fc.assert(
      fc.property(groups, fc.integer({ min: 5, max: 8 }), (all, minimum) => {
        const { shown, hidden } = placesShown(all, minimum)
        const hiddenPeople = new Set(
          all.filter((each) => hidden.includes(each.place)).flatMap((each) => [...each.people]),
        )
        expect(shown.length + hidden.length).toBe(all.length)
        expect(hidden.length === 0 || hiddenPeople.size >= minimum || shown.length === 0).toBe(true)
        for (const each of all.filter(
          (candidate) => shown.includes(candidate.place) && !hidden.includes(candidate.place),
        ))
          expect(each.people.size).toBeGreaterThanOrEqual(minimum)
      }),
    )
  })
})

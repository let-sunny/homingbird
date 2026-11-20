import type { PlaceName } from '@homingbird/protocol'
import { byPlace } from './trust-figures.ts'

/** Overlapping teams shown only while every cell of people sharing the same shown teams has `minimum`. */
export const teamsShown = (
  contributions: ReadonlyArray<Contribution>,
  minimum: number,
): { readonly shown: string[]; readonly hidden: string[] } => {
  const people = contributorsByTeam(contributions)
  const bySize = (a: string, b: string) => people.get(b)!.size - people.get(a)!.size || a.localeCompare(b)
  const teams = [...people.keys()].sort(bySize)
  const shown = teams.filter((team) => people.get(team)!.size >= minimum)
  for (;;) {
    const small = smallCell(contributions, new Set(shown), minimum)
    if (small === undefined || shown.length === 0) break
    const bordering = small.length === 0 ? shown : shown.filter((team) => small.includes(team))
    shown.splice(shown.indexOf(bordering.at(-1)!), 1)
  }
  return { shown, hidden: teams.filter((team) => !shown.includes(team)).sort((a, b) => a.localeCompare(b)) }
}

/** Disjoint groups shown only while each, and the hidden ones together, have `minimum` people. */
export const placesShown = (
  groups: ReadonlyArray<{ readonly place: PlaceName; readonly people: ReadonlySet<string> }>,
  minimum: number,
): { readonly shown: PlaceName[]; readonly hidden: PlaceName[] } => {
  const large = groups.filter((group) => group.people.size >= minimum)
  const hidden = groups.filter((group) => group.people.size < minimum)
  const shown = [...large].sort((a, b) => b.people.size - a.people.size || byPlace(a.place, b.place))
  const hiddenPeople = new Set(hidden.flatMap((group) => [...group.people]))
  while (hidden.length > 0 && hiddenPeople.size < minimum && shown.length > 0) {
    const smallest = shown.pop()!
    hidden.push(smallest)
    for (const person of smallest.people) hiddenPeople.add(person)
  }
  return { shown: shown.map((group) => group.place), hidden: hidden.map((group) => group.place) }
}

export interface Contribution {
  readonly person: string
  readonly teams: ReadonlyArray<string>
}

export const cellOf = (contribution: Contribution, shown: ReadonlySet<string>): string[] =>
  [...new Set(contribution.teams.filter((team) => shown.has(team)))].sort((a, b) => a.localeCompare(b))

const smallCell = (
  contributions: ReadonlyArray<Contribution>,
  shown: ReadonlySet<string>,
  minimum: number,
): string[] | undefined => {
  const cells = new Map<string, { readonly key: string[]; readonly people: Set<string> }>()
  for (const contribution of contributions) {
    const key = cellOf(contribution, shown)
    const name = JSON.stringify(key)
    const cell = cells.get(name) ?? { key, people: new Set<string>() }
    cell.people.add(contribution.person)
    cells.set(name, cell)
  }
  return [...cells].sort(([a], [b]) => a.localeCompare(b)).find(([, cell]) => cell.people.size < minimum)?.[1]
    .key
}

const contributorsByTeam = (contributions: ReadonlyArray<Contribution>): Map<string, Set<string>> => {
  const people = new Map<string, Set<string>>()
  for (const contribution of contributions)
    for (const team of contribution.teams) {
      const members = people.get(team) ?? new Set<string>()
      members.add(contribution.person)
      people.set(team, members)
    }
  return people
}

/** The people among some contributors, leaving out those nobody knows. */
export const peopleOf = (ids: Iterable<string | null>): Set<string> =>
  new Set([...ids].filter((id): id is string => id !== null))

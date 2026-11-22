import type { AsRead } from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { isArchived } from '../thread.ts'
import { type NameMatch, type NameMatchInput, nameMatches, roomMatch } from './name-matches.ts'
import type { WaitingPlace } from './waiting.ts'

/**
 * The switcher Cmd/Ctrl+K and `/` open. With nothing typed it lists what waits for the person, as
 * the activity panel does, then the conversations they were in most recently; typed, it lists the
 * people, channels and group messages whose name holds it. One option is chosen at a time, wrapping
 * around at either end.
 */
export const switcherModel = (input: SwitcherInput): SwitcherModel => {
  const sections = input.query.trim() === '' ? startingSections(input) : typedSections(input)
  const options = sections.flatMap((section) => section.options)
  const chosen =
    options.length === 0 ? -1 : ((input.chosen % options.length) + options.length) % options.length
  let index = 0
  const numbered = sections.map((section) => ({
    ...section,
    options: section.options.map((match) => {
      const at = index++
      return { ...match, id: `switcher-option-${at}`, chosen: at === chosen }
    }),
  }))
  return {
    title: strings.switcher.title,
    label: strings.switcher.label,
    placeholder: strings.switcher.placeholder,
    sections: numbered,
    chosenId: chosen === -1 ? null : `switcher-option-${chosen}`,
    chosen: chosen === -1 ? null : options[chosen]!,
    empty:
      options.length > 0
        ? null
        : input.query.trim() === ''
          ? strings.switcher.nothingYet
          : strings.switcher.none({ query: input.query.trim() }),
    footer: strings.switcher.footer({ open: input.shortcut }),
  }
}

export interface SwitcherInput extends NameMatchInput {
  readonly waiting: ReadonlyArray<WaitingPlace>
  /** The option the arrow keys chose, counted from the first; any number wraps around. */
  readonly chosen: number
  /** How the open shortcut is written on this device: “⌘K” or “Ctrl+K”. */
  readonly shortcut: string
}

export interface SwitcherModel {
  readonly title: string
  readonly label: string
  readonly placeholder: string
  readonly sections: ReadonlyArray<SwitcherSection>
  /** The element id of the chosen option, for the field's `aria-activedescendant`. */
  readonly chosenId: string | null
  readonly chosen: NameMatch | null
  readonly empty: string | null
  readonly footer: string
}

export interface SwitcherSection {
  readonly key: string
  readonly title: string
  readonly options: ReadonlyArray<SwitcherOption>
}

export type SwitcherOption = NameMatch & { readonly id: string; readonly chosen: boolean }

/** How many recent conversations the empty switcher lists under what waits. */
export const RECENT_SHOWN = 6

const startingSections = (input: SwitcherInput): ReadonlyArray<Section> => {
  const waitingIn = new Set(input.waiting.flatMap((place) => place.conversationId ?? []))
  const recent = input.conversations
    .filter((room) => !isArchived(room) && !waitingIn.has(room.id))
    .sort((one, other) => other.lastActivityAt - one.lastActivityAt)
    .slice(0, RECENT_SHOWN)
  return withOptions([
    {
      key: 'waiting',
      title: strings.switcher.waiting,
      options: input.waiting.map(
        (place): NameMatch => ({
          key: `waiting:${place.key}`,
          kind: 'waiting',
          label: place.text,
          detail: place.why,
          target: { kind: 'href', href: place.href },
        }),
      ),
    },
    {
      key: 'recent',
      title: strings.switcher.recent,
      options: recent.map((room: AsRead.Conversation) => roomMatch(input, room)),
    },
  ])
}

const typedSections = (input: SwitcherInput): ReadonlyArray<Section> => {
  const found = nameMatches(input)
  return withOptions([
    { key: 'people', title: strings.navPeople, options: found.people },
    { key: 'channels', title: strings.channels, options: found.channels },
    { key: 'rooms', title: strings.switcher.rooms, options: found.rooms },
  ])
}

const withOptions = (sections: ReadonlyArray<Section>): ReadonlyArray<Section> =>
  sections.filter((section) => section.options.length > 0)

interface Section {
  readonly key: string
  readonly title: string
  readonly options: ReadonlyArray<NameMatch>
}

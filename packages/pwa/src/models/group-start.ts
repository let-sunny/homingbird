import { type AsRead, type MemberId, RECIPIENTS_MAX, isPerson } from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { listOf, strings } from '../strings.ts'
import { groupWith } from '../thread.ts'

/**
 * Starting a conversation with several people from the people list: who is chosen, what to say about
 * it, and whom each card may add. Null when fewer than two people may be messaged at all.
 */
export const groupStartModel = (input: GroupStartInput): GroupStartModel | null => {
  const choosable = input.directory.filter((entry) => entry.canMessage && isPerson(entry.member))
  if (choosable.length < 2) return null
  const names = new Map(choosable.map((entry) => [entry.member.id, entry.member.name]))
  const chosen = chosenIn(input)
  const full = chosen.length >= RECIPIENTS_MAX
  const existing = chosen.length < 2 ? undefined : groupWith(input.conversations, input.viewerId, chosen)
  return {
    title: strings.groupStart.title,
    collapsed: chosen.length === 0 ? strings.groupStart.collapsed : null,
    intro: input.draftRequests ? strings.groupStart.intro : strings.groupStart.introWithoutRequests,
    count: strings.groupStart.chosen({ count: chosen.length }),
    status: statusOf(chosen.map((memberId) => names.get(memberId)!)),
    chips: chosen.map((memberId) => ({
      memberId,
      name: names.get(memberId)!,
      removeLabel: strings.groupStart.remove({ name: names.get(memberId)! }),
    })),
    full: full ? strings.groupStart.full({ count: RECIPIENTS_MAX }) : null,
    start: {
      label: input.starting ? strings.groupStart.starting : strings.groupStart.start,
      enabled: !input.starting && chosen.length >= 2,
    },
    existing:
      existing === undefined
        ? null
        : {
            text: strings.groupStart.existing,
            label: strings.groupStart.open,
            href: hrefFor({ name: 'conversation', id: existing.id, draft: null }),
          },
    clear: chosen.length === 0 ? null : strings.groupStart.clear,
    toggles: new Map(
      choosable.map((entry) => {
        const pressed = chosen.includes(entry.member.id)
        return [
          entry.member.id,
          {
            text: pressed ? strings.groupStart.added : strings.groupStart.choose,
            label: (pressed ? strings.groupStart.addedName : strings.groupStart.chooseName)({
              name: entry.member.name,
            }),
            pressed,
            disabled: input.starting || (full && !pressed),
          },
        ]
      }),
    ),
  }
}

/** Whom to start the conversation with: the people still chosen, or null until there are two. */
export const participantsToStart = (input: GroupStartInput): ReadonlyArray<MemberId> | null => {
  const chosen = chosenIn(input)
  return chosen.length >= 2 ? chosen : null
}

/** The people chosen after adding or removing one; a full conversation takes no one more. */
export const toggledChoice = (
  chosen: ReadonlyArray<MemberId>,
  memberId: MemberId,
): ReadonlyArray<MemberId> =>
  chosen.includes(memberId)
    ? chosen.filter((id) => id !== memberId)
    : chosen.length >= RECIPIENTS_MAX
      ? chosen
      : [...chosen, memberId]

export interface GroupStartInput {
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly viewerId: MemberId
  /** Who the person chose, in the order they chose them. */
  readonly chosen: ReadonlyArray<MemberId>
  readonly starting: boolean
  /** Whether the server lets a person ask their agent for a draft, which the intro then offers. */
  readonly draftRequests: boolean
}

export interface GroupStartModel {
  readonly title: string
  /** Until someone is added the box is one line, so the people list starts high on the page. */
  readonly collapsed: string | null
  readonly intro: string
  readonly count: string
  readonly status: string
  readonly chips: ReadonlyArray<{
    readonly memberId: MemberId
    readonly name: string
    readonly removeLabel: string
  }>
  readonly full: string | null
  readonly start: { readonly label: string; readonly enabled: boolean }
  /** The group room there already is with exactly the people chosen, opened instead of starting another. */
  readonly existing: { readonly text: string; readonly label: string; readonly href: string } | null
  readonly clear: string | null
  readonly toggles: ReadonlyMap<MemberId, ChoiceToggle>
}

export interface ChoiceToggle {
  readonly text: string
  readonly label: string
  readonly pressed: boolean
  readonly disabled: boolean
}

/** The chosen people the person may still message, each once, at most as many as a conversation holds. */
const chosenIn = (input: GroupStartInput): ReadonlyArray<MemberId> => {
  const choosable = new Set(
    input.directory.filter((entry) => entry.canMessage).map((entry) => entry.member.id),
  )
  return [...new Set(input.chosen)].filter((memberId) => choosable.has(memberId)).slice(0, RECIPIENTS_MAX)
}

const statusOf = (names: ReadonlyArray<string>): string =>
  names.length === 0
    ? strings.groupStart.none
    : names.length === 1
      ? strings.groupStart.needMore
      : strings.groupStart.with({ names: listOf(names) })

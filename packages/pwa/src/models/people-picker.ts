import { type AsRead, type MemberId, isPerson } from '@homingbird/protocol'
import { shownRelation } from '../relations.ts'
import { strings } from '../strings.ts'

/**
 * The people picker: a chip for each person chosen, and the people matching what was typed, in the
 * order given, each with their presence and, when they cannot be chosen, the reason.
 */
export const peoplePickerModel = (input: PeoplePickerInput): PeoplePickerModel => {
  const chosen = chosenAmong(input.candidates, input.chosen, input.limit)
  const full = input.limit !== null && chosen.length >= input.limit
  const typed = input.query.trim()
  const matching = input.candidates
    .filter((candidate) => !chosen.includes(candidate.memberId) && matches(candidate, typed.toLowerCase()))
    .slice(0, OPTIONS_SHOWN)
  const active = full ? null : activeAmong(matching, input.active)
  const named = new Map(input.candidates.map((candidate) => [candidate.memberId, candidate.name]))
  return {
    chips: chosen.map((memberId) => ({
      memberId,
      name: named.get(memberId)!,
      removeLabel: strings.picker.remove({ name: named.get(memberId)! }),
    })),
    expanded: input.open && matching.length > 0,
    options: matching.map((candidate) => ({
      id: optionId(input.id, candidate.memberId),
      memberId: candidate.memberId,
      name: candidate.name,
      email: candidate.email,
      presence: candidate.presence,
      reason: candidate.reason,
      disabled: full || candidate.reason !== null,
      active: candidate.memberId === active,
    })),
    activeId: active === null ? null : optionId(input.id, active),
    status: !input.open
      ? ''
      : matching.length > 0
        ? strings.picker.matches({ count: matching.length })
        : typed === ''
          ? strings.picker.nobodyLeft
          : strings.picker.noMatch({ query: typed }),
    full: full ? strings.picker.full({ count: input.limit! }) : null,
  }
}

/** What a key pressed in the picker's field does; nothing while an input method is composing. */
export const pickerKey = (
  key: string,
  composing: boolean,
  query: string,
  model: PeoplePickerModel,
): PickerMove => {
  if (composing) return NOTHING
  const choosable = model.options.filter((option) => !option.disabled)
  const at = choosable.findIndex((option) => option.active)
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (choosable.length === 0) return NOTHING
    const step = key === 'ArrowDown' ? 1 : choosable.length - 1
    return { kind: 'move', memberId: choosable[(at + step) % choosable.length]!.memberId }
  }
  if (key === 'Enter') return at === -1 ? NOTHING : { kind: 'choose', memberId: choosable[at]!.memberId }
  if (key === 'Backspace' && query === '' && model.chips.length > 0)
    return { kind: 'remove', memberId: model.chips.at(-1)!.memberId }
  if (key === 'Escape' && model.expanded) return { kind: 'close' }
  return NOTHING
}

/** The people chosen that may still be, each once, in the order chosen, at most `limit` of them. */
export const chosenAmong = (
  candidates: ReadonlyArray<PickerCandidate>,
  chosen: ReadonlyArray<MemberId>,
  limit: number | null,
): ReadonlyArray<MemberId> => {
  const choosable = new Set(
    candidates.filter((candidate) => candidate.reason === null).map((candidate) => candidate.memberId),
  )
  const kept = [...new Set(chosen)].filter((memberId) => choosable.has(memberId))
  return limit === null ? kept : kept.slice(0, limit)
}

/** The people chosen once one more is added; a full picker takes no one more. */
export const withChosen = (
  chosen: ReadonlyArray<MemberId>,
  memberId: MemberId,
  limit: number | null,
): ReadonlyArray<MemberId> =>
  chosen.includes(memberId) || (limit !== null && chosen.length >= limit) ? chosen : [...chosen, memberId]

/**
 * Everyone the person may write a note to, the people they wrote with most recently first. A person
 * they may not write to is listed with the reason rather than left out, so nobody seems to be missing.
 */
export const messageCandidates = (input: MessageCandidatesInput): ReadonlyArray<PickerCandidate> => {
  const lastWith = new Map<MemberId, number>()
  for (const conversation of input.conversations)
    if (conversation.kind !== 'channel')
      for (const memberId of conversation.participantIds)
        lastWith.set(memberId, Math.max(lastWith.get(memberId) ?? 0, conversation.lastActivityAt))
  return input.directory
    .filter((entry) => isPerson(entry.member) && entry.member.id !== input.viewerId)
    .sort(
      (a, b) =>
        (lastWith.get(b.member.id) ?? 0) - (lastWith.get(a.member.id) ?? 0) ||
        a.member.name.localeCompare(b.member.name),
    )
    .map((entry) => candidateOf(entry, entry.canMessage ? null : whyNot(entry, input.contactMode)))
}

/** The people who may be chosen, in name order: every person but those `excluded`, such as the viewer. */
export const candidatesAmong = (
  directory: ReadonlyArray<AsRead.DirectoryEntry>,
  excluded: ReadonlySet<MemberId>,
): ReadonlyArray<PickerCandidate> =>
  directory
    .filter((entry) => isPerson(entry.member) && !excluded.has(entry.member.id))
    .sort((a, b) => a.member.name.localeCompare(b.member.name))
    .map((entry) => candidateOf(entry, null))

/**
 * The people who may be asked to a flock, in name order: every person but the viewer, listed with
 * the reason when the viewer blocked them, or when they asked the note the room is about, since they would
 * read the room before its answer is approved.
 */
export const roomCandidates = (
  directory: ReadonlyArray<AsRead.DirectoryEntry>,
  viewerId: MemberId,
  askerId: MemberId | null,
): ReadonlyArray<PickerCandidate> =>
  candidatesAmong(directory, new Set([viewerId])).map((candidate) => {
    const name = candidate.name
    if (candidate.memberId === askerId)
      return { ...candidate, reason: strings.debateSuggestion.askerLeftOut({ name }) }
    const blocked = directory.some(
      (entry) => entry.member.id === candidate.memberId && entry.relation === 'blocked',
    )
    return blocked ? { ...candidate, reason: strings.debateSuggestion.blocked({ name }) } : candidate
  })

export interface PickerCandidate {
  readonly memberId: MemberId
  readonly name: string
  readonly email: string
  readonly presence: AsRead.Presence
  /** Why this person cannot be chosen, or null when they can. */
  readonly reason: string | null
}

export interface PeoplePickerInput {
  /** Names the field and its options, so several pickers may share a page. */
  readonly id: string
  readonly candidates: ReadonlyArray<PickerCandidate>
  readonly chosen: ReadonlyArray<MemberId>
  readonly query: string
  /** The option the person moved to with the arrow keys; the first that may be chosen otherwise. */
  readonly active: MemberId | null
  /** Whether the list of matching people is open: while the field has the focus. */
  readonly open: boolean
  readonly limit: number | null
}

export interface PeoplePickerModel {
  readonly chips: ReadonlyArray<{
    readonly memberId: MemberId
    readonly name: string
    readonly removeLabel: string
  }>
  readonly expanded: boolean
  readonly options: ReadonlyArray<PickerOption>
  readonly activeId: string | null
  /** How many match, for assistive technology; empty while the list is closed. */
  readonly status: string
  readonly full: string | null
}

export interface PickerOption {
  readonly id: string
  readonly memberId: MemberId
  readonly name: string
  readonly email: string
  readonly presence: AsRead.Presence
  readonly reason: string | null
  readonly disabled: boolean
  readonly active: boolean
}

export type PickerMove =
  | { readonly kind: 'none' }
  | { readonly kind: 'move'; readonly memberId: MemberId }
  | { readonly kind: 'choose'; readonly memberId: MemberId }
  | { readonly kind: 'remove'; readonly memberId: MemberId }
  | { readonly kind: 'close' }

export interface MessageCandidatesInput {
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly viewerId: MemberId
  readonly contactMode: AsRead.Settings['contactMode']
}

/** As many matching people as fit on a phone's screen above its keyboard. */
const OPTIONS_SHOWN = 8

const NOTHING: PickerMove = { kind: 'none' }

const matches = (candidate: PickerCandidate, query: string): boolean =>
  candidate.name.toLowerCase().includes(query) || candidate.email.toLowerCase().includes(query)

const activeAmong = (options: ReadonlyArray<PickerCandidate>, wanted: MemberId | null): MemberId | null => {
  const choosable = options.filter((option) => option.reason === null)
  return (choosable.find((option) => option.memberId === wanted) ?? choosable[0])?.memberId ?? null
}

const optionId = (pickerId: string, memberId: MemberId): string => `${pickerId}-${memberId}`

const candidateOf = (entry: AsRead.DirectoryEntry, reason: string | null): PickerCandidate => ({
  memberId: entry.member.id,
  name: entry.member.name,
  email: entry.member.email,
  presence: entry.presence,
  reason,
})

const whyNot = (entry: AsRead.DirectoryEntry, mode: AsRead.Settings['contactMode']): string => {
  const name = entry.member.name
  const relation = shownRelation(entry, mode)
  if (relation === 'blocked') return strings.picker.blocked({ name })
  if (entry.member.status !== 'active') return strings.picker.inactive({ name })
  if (mode !== 'contacts' || relation === 'contact') return strings.picker.cannot({ name })
  if (relation === 'request_sent') return strings.picker.requested({ name })
  if (relation === 'request_received') return strings.picker.toAccept({ name })
  return strings.picker.contactsOnly({ name })
}

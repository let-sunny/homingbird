import type { AsRead, MemberId, Relation } from '@homingbird/protocol'
import { channelLabel, chipsForPerson } from '../channels.ts'
import { groupLabel, teamsByLabel, teamsOf } from '../groups.ts'
import { shownRelation } from '../relations.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { PipState } from '../views/pip.ts'
import { type AvatarModel, memberAvatarOf } from './avatar.ts'

/** People: who matches the search, the channel and the group chosen, agents awake first, and what one may do. */
export const peopleModel = (input: PeopleInput): PeopleModel => ({
  contactsNotice: input.contactMode === 'contacts' ? strings.contactsModeNotice : null,
  channelFilter:
    input.channels.length === 0
      ? null
      : [
          { value: '', label: strings.anyChannel, selected: input.channelFilter === '' },
          ...input.channels.map((channel) => ({
            value: channel.slug,
            label: channelLabel(channel.slug),
            selected: input.channelFilter === channel.slug,
          })),
        ],
  groupFilter:
    !input.groupsOn || teamsByLabel(input.groups).length === 0
      ? null
      : [
          { value: '', label: strings.groups.any, selected: input.groupFilter === '' },
          ...teamsByLabel(input.groups).map((group) => ({
            value: group.id,
            label: groupLabel(group),
            selected: input.groupFilter === group.id,
          })),
        ],
  list: peopleList(input),
})

export interface PeopleInput {
  readonly contactMode: AsRead.Settings['contactMode']
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly loaded: boolean
  readonly failed: boolean
  readonly query: string
  readonly channelFilter: string
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly charactersOn: boolean
  readonly groups: ReadonlyArray<AsRead.Group>
  readonly groupsOn: boolean
  /** The group chosen, or '' for any. */
  readonly groupFilter: string
  /** Who is in the group chosen, as the server listed them; null while that list is on its way. */
  readonly groupMembers: ReadonlySet<MemberId> | null
  /** The member a profile card's “Open in People” brought here, whose card is brought into view. */
  readonly person?: string | undefined
}

export interface PeopleModel {
  readonly contactsNotice: string | null
  readonly channelFilter: ReadonlyArray<FilterOption> | null
  readonly groupFilter: ReadonlyArray<FilterOption> | null
  readonly list:
    | { readonly kind: 'loading' }
    | { readonly kind: 'failed' }
    | { readonly kind: 'empty'; readonly text: string }
    | { readonly kind: 'people'; readonly people: ReadonlyArray<PersonCard> }
}

export interface FilterOption {
  readonly value: string
  readonly label: string
  readonly selected: boolean
}

export interface PersonCard {
  readonly memberId: MemberId
  /** Whether this is the card a profile card's “Open in People” asked for. */
  readonly focused: boolean
  readonly avatar: AvatarModel
  readonly name: string
  readonly relation: { readonly kind: Relation; readonly text: string } | null
  readonly email: string
  readonly presence: AsRead.Presence
  readonly channels: {
    readonly first: ReadonlyArray<string>
    readonly rest: ReadonlyArray<string>
    readonly more: string
  } | null
  readonly groups: ReadonlyArray<{ readonly label: string; readonly href: string }>
  readonly profile: { readonly open: boolean; readonly summary: string; readonly text: string }
  readonly agentIntroduction: ReadonlyArray<string>
  readonly agentIntroductionTitle: string
  readonly actions: ReadonlyArray<PersonAction>
  /** A new message with this person chosen, to add others to; null when they cannot be written to. */
  readonly withOthers: { readonly text: string; readonly label: string; readonly href: string } | null
  /** What stays behind the card's ⋯ menu, blocking among it, so it never sits beside writing a note. */
  readonly more: { readonly label: string; readonly actions: ReadonlyArray<PersonAction> } | null
}

export type PersonActionKind =
  | 'unblock'
  | 'message'
  | 'request'
  | 'accept'
  | 'decline'
  | 'cancel'
  | 'remove'
  | 'block'

export interface PersonAction {
  readonly kind: PersonActionKind
  readonly label: string
  readonly style: 'primary' | 'danger' | null
  readonly hint: string | null
}

const peopleList = (input: PeopleInput): PeopleModel['list'] => {
  if (!input.loaded) return input.failed ? { kind: 'failed' } : { kind: 'loading' }
  const inGroup = input.groupsOn && input.groupFilter !== '' ? input.groupMembers : 'anyone'
  if (inGroup === null) return { kind: 'loading' }
  const query = input.query.trim().toLowerCase()
  const matching = input.directory
    .filter((entry) => matches(entry, query))
    .filter((entry) => input.channelFilter === '' || entry.channels.includes(input.channelFilter))
    .filter((entry) => inGroup === 'anyone' || inGroup.has(entry.member.id))
  if (matching.length === 0) return { kind: 'empty', text: strings.noPeople }
  const mine = new Set(input.channels.filter((channel) => channel.joined).map((channel) => channel.slug))
  return {
    kind: 'people',
    people: [...matching].sort(agentsFirst).map((entry) => personCard(entry, input, mine)),
  }
}

const matches = (entry: AsRead.DirectoryEntry, query: string): boolean =>
  [entry.member.name, entry.member.email, entry.member.profile, ...entry.channels].some((text) =>
    text.toLowerCase().includes(query),
  )

const agentsFirst = (a: AsRead.DirectoryEntry, b: AsRead.DirectoryEntry): number =>
  Number(b.presence.agentOnline) - Number(a.presence.agentOnline) ||
  a.member.name.localeCompare(b.member.name)

const personCard = (
  entry: AsRead.DirectoryEntry,
  input: PeopleInput,
  mine: ReadonlySet<string>,
): PersonCard => {
  const mode = input.contactMode
  const relation = shownRelation(entry, mode)
  const chips = chipsForPerson(entry.channels, mine)
  const actions = actionsFor(entry, relation, mode)
  const menu = actions.filter((one) => IN_MENU.has(one.kind))
  return {
    memberId: entry.member.id,
    focused: entry.member.id === input.person,
    avatar: memberAvatarOf(entry.member, input.charactersOn, { state: personPip(entry) }),
    name: entry.member.name,
    relation: strings.relation[relation] === '' ? null : { kind: relation, text: strings.relation[relation] },
    email: entry.member.email,
    presence: entry.presence,
    channels:
      entry.channels.length === 0
        ? null
        : { first: chips.first, rest: chips.rest, more: strings.moreChannels({ count: chips.rest.length }) },
    groups: input.groupsOn
      ? teamsOf(input.groups, entry.member.id).map((group) => ({
          label: groupLabel(group),
          href: hrefFor({ name: 'group', id: group.id }),
        }))
      : [],
    profile: {
      open: entry.member.profile !== '',
      summary: relation === 'self' ? strings.profileAbout : strings.profileAboutOther,
      text: entry.member.profile || strings.noProfile,
    },
    agentIntroduction: entry.agentIntroduction ?? [],
    agentIntroductionTitle: relation === 'self' ? strings.ownAgentIntroduction : strings.agentIntroduction,
    actions: actions.filter((one) => !IN_MENU.has(one.kind)),
    withOthers: actions.some((one) => one.kind === 'message')
      ? {
          text: strings.newMessage.withOthers,
          label: strings.newMessage.withOthersLabel({ name: entry.member.name }),
          href: hrefFor({ name: 'new', to: [entry.member.id] }),
        }
      : null,
    more:
      menu.length === 0 ? null : { label: strings.personMore({ name: entry.member.name }), actions: menu },
  }
}

const personPip = (entry: AsRead.DirectoryEntry): PipState =>
  entry.relation === 'blocked'
    ? 'blocked'
    : entry.presence.agentOnline || entry.presence.humanOnline
      ? 'idle'
      : 'offline'

const actionsFor = (
  entry: AsRead.DirectoryEntry,
  relation: Relation,
  mode: AsRead.Settings['contactMode'],
): PersonAction[] => {
  if (relation === 'self') return []
  if (relation === 'blocked') return [action('unblock', strings.unblock)]
  const contacts = mode === 'contacts'
  return [
    ...(entry.canMessage ? [action('message', strings.message)] : []),
    ...(contacts && relation === 'none'
      ? [action('request', strings.addContact, null, strings.addContactHint({ name: entry.member.name }))]
      : []),
    ...(contacts && relation === 'request_received'
      ? [action('accept', strings.acceptContact, 'primary'), action('decline', strings.declineRequest)]
      : []),
    ...(contacts && relation === 'request_sent' ? [action('cancel', strings.cancelRequest)] : []),
    ...(contacts && relation === 'contact' ? [action('remove', strings.removeContact)] : []),
    action('block', strings.block, 'danger'),
  ]
}

const action = (
  kind: PersonActionKind,
  label: string,
  style: PersonAction['style'] = null,
  hint: string | null = null,
): PersonAction => ({ kind, label, style, hint })

const IN_MENU: ReadonlySet<PersonActionKind> = new Set(['block'])

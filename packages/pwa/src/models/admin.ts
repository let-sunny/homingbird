import {
  ANSWERING_FLOW_MAX_CHARACTERS,
  type AsRead,
  FEATURE_NAMES,
  type FeatureName,
  type FlowStep,
  type Group,
} from '@homingbird/protocol'
import { flowSize, mayInsertExample } from '../answering-flow.ts'
import { channelLabel } from '../channels.ts'
import { featureOn } from '../features.ts'
import { channelList, channelsManagedBy, groupLabel, groupsOf, teamsOf } from '../groups.ts'
import { presenceShown, unavailableOf } from '../presence.ts'
import { type AdminSection, hrefFor } from '../routes.ts'
import { formats, listOf, locale, strings } from '../strings.ts'

/** Administration: its tabs, the one shown, and Groups and Insights only where the organization has them. */
export const adminModel = (info: AsRead.ServerInfo | null, section: AdminSection): AdminModel => {
  const insights = featureOn('insights', info)
  const groups = featureOn('groups', info)
  const sections: ReadonlyArray<readonly [AdminSection, string]> = [
    ['settings', strings.adminSettings],
    ['members', strings.adminMembers],
    ...(groups ? [['groups', strings.groups.title] as const] : []),
    ['channels', strings.adminChannels],
    ...(insights ? [['insights', strings.adminInsights] as const] : []),
  ]
  const isOff = (section === 'insights' && !insights) || (section === 'groups' && !groups)
  return {
    title: strings.adminTitle,
    tabs: sections.map(([name, label]) => ({
      href: hrefFor({ name: 'admin', section: name }),
      label,
      current: name === section,
    })),
    shown: isOff ? 'settings' : section,
  }
}

/**
 * The bar that saves the settings: shown, and sticking to the bottom of the page, only once something
 * differs from what was last saved, so a change far down the page is never left behind unsaved.
 */
export const saveBarModel = (saved: SettingsEdit, edited: SettingsEdit): SaveBarModel => ({
  shown: !isSameSettings(saved, edited),
  text: strings.unsavedSettings,
  save: strings.save,
})

/** The allowed sign-in domains as typed: one per line or comma, lower case, without blanks. */
export const domainsFrom = (typed: string): string[] =>
  typed
    .split(/[\s,]+/)
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain !== '')

/** The choices for who makes invite links, the saved one selected; unknown reads as administrators. */
export const whoCanInviteChoices = (
  saved: AsRead.Settings['whoCanInvite'],
): ReadonlyArray<{
  readonly value: 'admins' | 'members'
  readonly label: string
  readonly selected: boolean
}> => [
  { value: 'admins', label: strings.whoCanInviteAdmins, selected: saved !== 'members' },
  { value: 'members', label: strings.whoCanInviteMembers, selected: saved === 'members' },
]

/** One row per optional feature, with its switch and what people lose without it. */
export const featureRows = (switches: Readonly<Record<FeatureName, boolean>>): ReadonlyArray<FeatureRow> =>
  FEATURE_NAMES.map((name) => ({
    name,
    on: switches[name],
    className: `todo-row feature-row${switches[name] ? '' : ' is-off'}`,
    label: strings.features.names[name],
    loss: strings.features.whenOff[name],
    check: switches[name] ? '✓' : '',
  }))

/** The answering flow's counters and whether the example may be put in. */
export const flowToolsModel = (steps: ReadonlyArray<FlowStep>): FlowTools => {
  const size = flowSize(steps)
  return {
    counterClass: `flow-count${size.over ? ' is-over' : ''}`,
    counter: `${strings.answeringFlow.counter({ used: size.used, max: size.max })} · ${strings.answeringFlow.stepsCounter({ steps: size.steps, max: size.maxSteps })}`,
    exampleDisabled: !mayInsertExample(steps),
    maxCharacters: ANSWERING_FLOW_MAX_CHARACTERS,
  }
}

/**
 * Administration → Members: each member's role, status, last activity, agent, agent connections, teams
 * and the channels they manage, flagged when they have shown no activity for 30 days, filtered by a
 * search over name, email and group.
 */
export const adminMembersModel = (input: AdminMembersInput): AdminMembersModel => {
  if (input.members === null) return null
  const entries = new Map(input.directory.map((entry) => [entry.member.id, entry]))
  const held =
    input.agentCredentials === null
      ? null
      : new Map(input.agentCredentials.map((each) => [each.memberId, each]))
  const rows = input.members
    .map((member) => memberRow(input, member, entries.get(member.id), held))
    .filter((row) => matchesSearch(row, input.query))
  const query = input.query.trim()
  return {
    rows,
    noMatch: rows.length === 0 && query !== '' ? strings.adminMemberList.noMatch({ query }) : null,
  }
}

/** Whether a member has shown no activity for 30 days: their last connection, or their joining if none. */
export const isDormant = (member: AsRead.Member, lastSeenAt: number | null, now: number): boolean =>
  member.status === 'active' && now - (lastSeenAt ?? member.createdAt) > DORMANT_AFTER_MS

/**
 * What deactivating a member does to their groups: it removes them from every one, so the dialog names
 * those groups and a colleague can be added first. Null when they are in none.
 */
export const deactivationModel = (
  member: AsRead.Member,
  groups: ReadonlyArray<AsRead.Group>,
): Confirmation | null => {
  const leaves = groupsOf(groups, member.id)
  return leaves.length === 0
    ? null
    : {
        title: strings.deactivateTitle({ name: member.name }),
        body: strings.groups.deactivateLeaves({
          name: member.name,
          groups: listOf(leaves.map((group) => groupLabel(group))),
        }),
        confirm: strings.deactivate,
      }
}

/** Administration → Channels: loading, a retry, none, or each channel with its edit and archive. */
export const adminChannelsModel = (
  channels: ReadonlyArray<AsRead.Channel>,
  loaded: boolean,
  failed: boolean,
): AdminChannelsModel => {
  if (!loaded) return failed ? { kind: 'failed' } : { kind: 'loading' }
  if (channels.length === 0) return { kind: 'empty', text: strings.adminNoChannels }
  return {
    kind: 'channels',
    rows: channels.map((channel) => ({
      channel,
      label: channelLabel(channel.slug),
      editTitle: strings.editChannelTitle({ channel: channelLabel(channel.slug) }),
      archiveTitle: strings.archiveChannelTitle({ channel: channelLabel(channel.slug) }),
    })),
  }
}

/** What archiving a channel does, and where its members may move. */
export const archiveModel = (channels: ReadonlyArray<AsRead.Channel>, slug: string): ArchiveModel => {
  const others = channels.filter((other) => other.slug !== slug)
  return {
    effects: [
      strings.archiveLeavesList,
      strings.archiveRoomReadOnly,
      strings.archiveNotesStay,
      strings.archiveDraftsDiscarded,
      ...(others.length > 0 ? [strings.archiveMembersMove] : []),
    ],
    moveTo:
      others.length === 0
        ? null
        : others.map((other) => ({ value: other.slug, label: channelLabel(other.slug) })),
  }
}

export interface AdminModel {
  readonly title: string
  readonly tabs: ReadonlyArray<{ readonly href: string; readonly label: string; readonly current: boolean }>
  readonly shown: AdminSection
}

export interface Confirmation {
  readonly title: string
  readonly body: string
  readonly confirm: string
}

/** The settings as the form holds them: what a save would send, before the contact mode is checked. */
export interface SettingsEdit {
  readonly allowedDomains: ReadonlyArray<string>
  readonly contactMode: string
  readonly answeringFlow?: string | null
  readonly whoCanInvite?: string
  readonly features: Readonly<Record<string, boolean>>
}

export interface SaveBarModel {
  readonly shown: boolean
  readonly text: string
  readonly save: string
}

export interface FeatureRow {
  readonly name: FeatureName
  readonly on: boolean
  readonly className: string
  readonly label: string
  readonly loss: string
  readonly check: string
}

export interface FlowTools {
  readonly counterClass: string
  readonly counter: string
  readonly exampleDisabled: boolean
  readonly maxCharacters: number
}

export type MemberActionKind = 'make-member' | 'make-admin' | 'deactivate' | 'reactivate' | 'reset-character'

export interface AdminMembersInput {
  readonly members: ReadonlyArray<AsRead.Member> | null
  readonly viewerId: string
  readonly charactersOn: boolean
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly groups: ReadonlyArray<AsRead.Group>
  /** Null from a server that does not say. */
  readonly agentCredentials: ReadonlyArray<AsRead.AgentCredentialsHeld> | null
  readonly query: string
  readonly now: number
}

export type AdminMembersModel = {
  readonly rows: ReadonlyArray<AdminMemberRow>
  readonly noMatch: string | null
} | null

export interface AdminMemberRow {
  readonly member: AsRead.Member
  readonly isYou: boolean
  readonly role: { readonly className: string; readonly text: string }
  readonly status: { readonly className: string; readonly text: string }
  /** Null where the directory has no entry for them, as for a deactivated member. */
  readonly lastActive: { readonly text: string; readonly title: string | null } | null
  readonly agent: { readonly className: string; readonly text: string | null; readonly title: string } | null
  readonly dormant: string | null
  /** Every group's label, teams and channels' managers, for the search. */
  readonly groupNames: ReadonlyArray<string>
  /** The teams they are in; a channel's managers are named in `manages` instead. */
  readonly groups: string | null
  readonly manages: string | null
  /** Null where the server does not say. */
  readonly agentCredentials: string | null
  readonly actions: ReadonlyArray<{
    readonly kind: MemberActionKind
    readonly label: string
    readonly danger: boolean
  }>
}

export type AdminChannelsModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'empty'; readonly text: string }
  | {
      readonly kind: 'channels'
      readonly rows: ReadonlyArray<{
        readonly channel: AsRead.Channel
        readonly label: string
        readonly editTitle: string
        readonly archiveTitle: string
      }>
    }

export interface ArchiveModel {
  readonly effects: ReadonlyArray<string>
  readonly moveTo: ReadonlyArray<{ readonly value: string; readonly label: string }> | null
}

const memberAction = (kind: MemberActionKind, label: string, style?: 'danger') => ({
  kind,
  label,
  danger: style === 'danger',
})

const memberRow = (
  input: AdminMembersInput,
  member: AsRead.Member,
  entry: AsRead.DirectoryEntry | undefined,
  held: ReadonlyMap<string, AsRead.AgentCredentialsHeld> | null,
): AdminMemberRow => {
  const groupNames = groupsOf(input.groups, member.id).map(groupLabel)
  const teams = teamsOf(input.groups, member.id).map(groupLabel)
  const managed = channelsManagedBy(input.groups, member.id)
  return {
    member,
    isYou: member.id === input.viewerId,
    role: { className: `kind is-${member.role}`, text: strings.memberRole[member.role] },
    status: { className: `kind is-${member.status}`, text: strings.memberStatus[member.status] },
    lastActive: entry === undefined ? null : lastActiveOf(entry.lastSeenAt, input.now),
    agent: entry === undefined ? null : agentOf(entry.presence),
    dormant:
      entry !== undefined && isDormant(member, entry.lastSeenAt, input.now)
        ? strings.adminMemberList.dormant
        : null,
    groupNames,
    groups:
      teams.length === 0 ? null : strings.adminMemberList.groups({ groups: formats.names.format(teams) }),
    manages: managed.length === 0 ? null : strings.groups.manages({ channels: channelList(managed) }),
    agentCredentials: held === null ? null : agentCredentialsOf(held.get(member.id)),
    actions: member.id === input.viewerId ? [] : memberActions(member, input.charactersOn),
  }
}

const memberActions = (member: AsRead.Member, charactersOn: boolean): AdminMemberRow['actions'] => [
  ...(member.role === 'admin' ? [memberAction('make-member', strings.makeMember)] : []),
  ...(member.role === 'member' ? [memberAction('make-admin', strings.makeAdmin)] : []),
  ...(member.status === 'active' ? [memberAction('deactivate', strings.deactivate, 'danger')] : []),
  ...(member.status === 'deactivated' ? [memberAction('reactivate', strings.reactivate)] : []),
  ...(member.character != null && charactersOn
    ? [memberAction('reset-character', strings.character.resetMember)]
    : []),
]

const matchesSearch = (row: AdminMemberRow, query: string): boolean => {
  const wanted = query.trim().toLocaleLowerCase()
  return (
    wanted === '' ||
    [row.member.name, row.member.email, ...row.groupNames].some((text) =>
      text.toLocaleLowerCase().includes(wanted),
    )
  )
}

const lastActiveOf = (lastSeenAt: number | null, now: number): NonNullable<AdminMemberRow['lastActive']> =>
  lastSeenAt === null
    ? { text: strings.adminMemberList.neverActive, title: null }
    : {
        text: strings.adminMemberList.lastActive({ when: timeSince(lastSeenAt, now) }),
        title: strings.adminMemberList.lastActiveTitle({ time: formats.full.format(new Date(lastSeenAt)) }),
      }

const agentCredentialsOf = (held: AsRead.AgentCredentialsHeld | undefined): string =>
  held === undefined
    ? strings.adminMemberList.noAgentCredentials
    : strings.adminMemberList.agentCredentials({
        count: held.count,
        date: formats.day.format(new Date(held.newestExpiresAt)),
      })

const agentOf = (presence: AsRead.Presence): NonNullable<AdminMemberRow['agent']> => {
  const shown = presenceShown(presence, true).agent
  const state = shown.isOn ? 'is-on' : unavailableOf(presence) === null ? 'is-off' : 'is-unavailable'
  return { className: `agent-light ${state}`, text: shown.words, title: shown.title }
}

const timeSince = (then: number, now: number): string => {
  const elapsed = Math.max(0, now - then)
  const [unit, size] = SINCE_UNITS.find(([, size]) => elapsed >= size) ?? SECOND
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  return relative.format(-Math.floor(elapsed / size), unit)
}

const isSameSettings = (a: SettingsEdit, b: SettingsEdit): boolean =>
  a.allowedDomains.join('\n') === b.allowedDomains.join('\n') &&
  a.contactMode === b.contactMode &&
  a.answeringFlow === b.answeringFlow &&
  a.whoCanInvite === b.whoCanInvite &&
  FEATURE_NAMES.every((name) => a.features[name] === b.features[name])

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const DORMANT_AFTER_MS = 30 * DAY_MS
const SECOND: readonly [Intl.RelativeTimeFormatUnit, number] = ['second', 1000]
const SINCE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['day', DAY_MS],
  ['hour', HOUR_MS],
  ['minute', MINUTE_MS],
]

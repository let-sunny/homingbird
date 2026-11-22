import type { AsRead, ChannelMember, GroupId, MemberId } from '@homingbird/protocol'
import { type Roster, channelLabel, isPrivate } from '../channels.ts'
import { groupById, groupLabel, teamsByLabel } from '../groups.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { type PickerCandidate, candidatesAmong } from './people-picker.ts'

/** A channel's own controls: answering there, managing its members, and leaving it. */
export const roomControlsModel = (
  channel: AsRead.Channel,
  roster: Roster | null,
  viewerId: MemberId | null,
  viewerIsAdmin = false,
): RoomControls => {
  const refusal = leaveRefusal(channel, roster?.members ?? null, viewerId)
  const seesMembers = channel.managing || (viewerIsAdmin && isPrivate(channel))
  return {
    answering: channel.joined ? answeringModel(channel) : null,
    more: {
      id: `room-menu-${channel.slug}`,
      label: strings.roomMore({ channel: channelLabel(channel.slug) }),
    },
    description: channel.description,
    manage: seesMembers ? strings.membersTitle({ channel: channelLabel(channel.slug) }) : null,
    leave: !channel.joined
      ? null
      : refusal !== null
        ? { kind: 'blocked', reason: refusal }
        : { kind: 'allowed', title: strings.leaveChannelTitle({ channel: channelLabel(channel.slug) }) },
    leaveBody: leaveConsequence(channel),
  }
}

/**
 * Why the person may not leave a channel, by the server's rule: a manager stays in the room while
 * anyone else is in it, so they first stop managing it, and that needs another manager. Null when they
 * may leave. Without the roster, whether they may manage it stands in for whether they do.
 */
export const leaveRefusal = (
  channel: AsRead.Channel,
  roster: ReadonlyArray<ChannelMember> | null,
  viewerId: MemberId | null,
): string | null => {
  const managers = (roster ?? []).filter((member) => member.manager)
  const isManager =
    roster === null ? channel.managing : managers.some((member) => member.memberId === viewerId)
  const others =
    roster === null ? channel.memberCount - 1 : roster.filter((member) => member.memberId !== viewerId).length
  if (!isManager || others <= 0) return null
  return roster !== null && managers.length <= 1 ? strings.onlyManagerCannotLeave : strings.managerCannotLeave
}

/** The roster a managed channel needs, and whether the cached one is out of date for its member count. */
export const rosterNeed = (
  channel: AsRead.Channel,
  rosters: ReadonlyMap<string, Roster>,
): { readonly roster: Roster | null; readonly stale: boolean } => {
  if (!channel.managing || !channel.joined) return { roster: null, stale: false }
  const cached = rosters.get(channel.slug)
  return { roster: cached ?? null, stale: cached?.memberCount !== channel.memberCount }
}

/** The answering switch of a channel the person is in. */
export const answeringModel = (channel: AsRead.Channel): AnsweringModel => ({
  labelId: `answering-label-${channel.slug}`,
  hintId: `answering-${channel.slug}`,
  label: strings.answerHere,
  hint: strings.answerHereHint,
  helpLabel: strings.answerHereHelp,
  checked: channel.answering,
  state: channel.answering ? strings.switchOn : strings.switchOff,
})

/**
 * The members panel: who manages the channel and adding managers, one by one or a team's people at once,
 * one row per member with what may be changed, adding members, and the visibility.
 */
export const membersPanelModel = (input: MembersPanelInput): MembersPanelModel => {
  const roster = input.roster
  const managedByAdmin =
    !input.viewerIsAdmin || input.channel.joined
      ? null
      : input.channel.managing
        ? strings.managedByAdmin
        : strings.seenByAdmin
  const managedBy = managedByModel(input)
  const managers = managersOf(input)
  if (roster === null)
    return {
      managedByAdmin,
      managedBy,
      addManager: null,
      addTeam: null,
      rows: null,
      addMember: null,
      visibility: null,
    }
  if (!input.channel.managing) return seenByAdministrator(input, roster, managedByAdmin, managedBy)
  const candidates = candidatesAmong(input.directory, new Set(roster.map((member) => member.memberId)))
  return {
    managedByAdmin,
    managedBy,
    addManager: addManagerModel(input, managers),
    addTeam: addTeamModel(input, managers),
    rows: roster.map((member) =>
      member.memberId === input.viewerId
        ? ownRow(input, member, roster, managers)
        : memberRow(input, member, managers),
    ),
    addMember: !isPrivate(input.channel)
      ? null
      : candidates.length === 0
        ? { kind: 'nobody', text: strings.nobodyToAdd }
        : { kind: 'choose', candidates },
    visibility: isPrivate(input.channel) ? strings.visibilityPrivate : strings.visibilityOpen,
  }
}

/** What leaving a channel means: a private one cannot be rejoined without being added again. */
export const leaveConsequence = (channel: AsRead.Channel): string =>
  isPrivate(channel)
    ? strings.leavePrivateChannelBody({ channel: channelLabel(channel.slug) })
    : strings.leaveChannelBody

export interface RoomControls {
  readonly answering: AnsweringModel | null
  /** The ⋯ menu that holds the room's other controls, beginning with what the channel is for. */
  readonly more: { readonly id: string; readonly label: string }
  readonly description: string
  readonly manage: string | null
  readonly leave:
    | { readonly kind: 'allowed'; readonly title: string }
    | { readonly kind: 'blocked'; readonly reason: string }
    | null
  readonly leaveBody: string
}

export interface AnsweringModel {
  readonly labelId: string
  readonly hintId: string
  readonly label: string
  readonly hint: string
  readonly helpLabel: string
  readonly checked: boolean
  readonly state: string
}

export interface MembersPanelInput {
  readonly channel: AsRead.Channel
  readonly roster: ReadonlyArray<ChannelMember> | null
  readonly viewerId: MemberId | null
  readonly viewerIsAdmin: boolean
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly groups: ReadonlyArray<AsRead.Group>
  readonly groupsOn: boolean
}

export interface MembersPanelModel {
  readonly managedByAdmin: string | null
  /** "Managed by Managers of #slug"; null when the person cannot see the channel's managers. */
  readonly managedBy: { readonly text: string } | null
  /** Adding one person to the managers, who joins the room; null when the person may not. */
  readonly addManager:
    | (Choice<MemberId> & { readonly groupId: GroupId; readonly memberIds: ReadonlyArray<MemberId> })
    | null
  /** Adding the people of a team to the managers, once; null when the person may not or no team adds anyone. */
  readonly addTeam: (Choice<GroupId> & { readonly hint: string }) | null
  readonly rows: ReadonlyArray<MemberRow> | null
  readonly addMember:
    | { readonly kind: 'nobody'; readonly text: string }
    | { readonly kind: 'choose'; readonly candidates: ReadonlyArray<PickerCandidate> }
    | null
  readonly visibility: string | null
}

export type MemberRow =
  | {
      readonly kind: 'own'
      readonly memberId: MemberId
      readonly name: string
      readonly roles: ReadonlyArray<Role>
      readonly blocked: string | null
      readonly leave: Confirmation
      readonly unmanage: Unmanage | null
    }
  | {
      readonly kind: 'other'
      readonly memberId: MemberId
      readonly name: string
      readonly roles: ReadonlyArray<Role>
      readonly remove: string | null
      readonly unmanage: Unmanage | null
    }

export interface Choice<A> {
  readonly label: string
  readonly choices: ReadonlyArray<{ readonly value: A; readonly label: string }>
}

/** Taking someone out of the managers: the label, and who the managers are afterwards. */
export interface Unmanage {
  readonly label: string
  readonly groupId: GroupId
  readonly memberIds: ReadonlyArray<MemberId>
  readonly confirm: Confirmation
}

export interface Role {
  readonly text: string
  readonly className: string
}

export interface Confirmation {
  readonly title: string
  readonly body: string
  readonly confirm: string
}

const roles = (member: ChannelMember): Role[] => [
  ...(member.manager ? [{ text: strings.managerLabel, className: 'kind is-manager' }] : []),
  ...(member.answering ? [{ text: strings.answersLabel, className: 'kind is-helping' }] : []),
]

const nameIn = (input: MembersPanelInput, memberId: MemberId): string =>
  input.members.get(memberId)?.name ?? strings.formerMember

const ownRow = (
  input: MembersPanelInput,
  member: ChannelMember,
  roster: ReadonlyArray<ChannelMember>,
  managers: AsRead.Group | null,
): MemberRow => {
  const label = channelLabel(input.channel.slug)
  return {
    kind: 'own',
    memberId: member.memberId,
    name: nameIn(input, member.memberId),
    roles: roles(member),
    blocked: leaveRefusal(input.channel, roster, input.viewerId),
    leave: {
      title: strings.leaveChannelTitle({ channel: label }),
      body: leaveConsequence(input.channel),
      confirm: strings.leaveChannel,
    },
    unmanage: unmanageModel(input, member, managers),
  }
}

/** A manager stays in the room while they manage it, so only others are removed from the room. */
const memberRow = (
  input: MembersPanelInput,
  member: ChannelMember,
  managers: AsRead.Group | null,
): MemberRow => ({
  kind: 'other',
  memberId: member.memberId,
  name: nameIn(input, member.memberId),
  roles: roles(member),
  remove: isPrivate(input.channel) && !member.manager ? strings.removeMember : null,
  unmanage: unmanageModel(input, member, managers),
})

/**
 * An administrator outside a private channel sees who is in it and may remove people, as the server
 * allows, but never adds a member or a manager, or opens the channel: only its managers do that.
 */
const seenByAdministrator = (
  input: MembersPanelInput,
  roster: ReadonlyArray<ChannelMember>,
  managedByAdmin: string | null,
  managedBy: MembersPanelModel['managedBy'],
): MembersPanelModel => ({
  managedByAdmin,
  managedBy,
  addManager: null,
  addTeam: null,
  rows: roster.map((member) => memberRow(input, member, managersOf(input))),
  addMember: null,
  visibility: null,
})

const managersOf = (input: MembersPanelInput): AsRead.Group | null =>
  input.groupsOn ? groupById(input.groups, input.channel.managedBy) : null

const managedByModel = (input: MembersPanelInput): MembersPanelModel['managedBy'] => {
  const group = groupById(input.groups, input.channel.managedBy)
  return group === null ? null : { text: strings.groups.managedBy({ group: groupLabel(group) }) }
}

/** Anyone in the directory who does not manage the channel yet; the server lets them into the room. */
const addManagerModel = (
  input: MembersPanelInput,
  managers: AsRead.Group | null,
): MembersPanelModel['addManager'] => {
  if (managers === null || !managers.mayAdd) return null
  const choices = input.directory
    .filter((entry) => entry.member.status === 'active' && !managers.memberIds.includes(entry.member.id))
    .map((entry) => ({ value: entry.member.id, label: `${entry.member.name} · ${entry.member.email}` }))
  return choices.length === 0
    ? null
    : { label: strings.groups.addManager, choices, groupId: managers.id, memberIds: managers.memberIds }
}

/** Every team that would add someone: its people are copied into the managers once. */
const addTeamModel = (
  input: MembersPanelInput,
  managers: AsRead.Group | null,
): MembersPanelModel['addTeam'] => {
  if (managers === null || !managers.mayAdd) return null
  const choices = teamsByLabel(input.groups)
    .filter((team) => team.memberIds.some((memberId) => !managers.memberIds.includes(memberId)))
    .map((team) => ({ value: team.id, label: groupLabel(team) }))
  return choices.length === 0
    ? null
    : { label: strings.groups.addTeam, hint: strings.groups.addTeamHint, choices }
}

/**
 * A channel keeps a manager, so the last one cannot be taken out. Taking one out is confirmed first,
 * with a warning when the one left would be the only manager.
 */
const unmanageModel = (
  input: MembersPanelInput,
  member: ChannelMember,
  managers: AsRead.Group | null,
): Unmanage | null => {
  if (managers === null || !managers.mayRemove || !member.manager || managers.memberIds.length < 2)
    return null
  const remaining = managers.memberIds.filter((memberId) => memberId !== member.memberId)
  const isSelf = member.memberId === input.viewerId
  const name = nameIn(input, member.memberId)
  const only = remaining.length === 1 ? remaining[0]! : null
  const warning =
    only === null
      ? null
      : only === input.viewerId
        ? strings.groups.onlyManagerYou
        : strings.groups.onlyManagerOther({ name: nameIn(input, only) })
  return {
    label: strings.groups.unmanage,
    groupId: managers.id,
    memberIds: remaining,
    confirm: {
      title: isSelf
        ? strings.groups.unmanageSelfTitle({ channel: channelLabel(input.channel.slug) })
        : strings.groups.unmanageTitle({ name }),
      body: [isSelf ? strings.groups.unmanageSelfBody : strings.groups.unmanageBody({ name }), warning]
        .filter((line) => line !== null)
        .join(' '),
      confirm: strings.groups.unmanage,
    },
  }
}

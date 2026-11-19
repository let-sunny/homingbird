import type { AsRead, ChannelMember, MemberId } from '@homingbird/protocol'
import { type Roster, channelLabel, isPrivate, rosterFacts } from '../channels.ts'
import { strings } from '../strings.ts'

/** A channel's own controls: answering there, managing its members, and leaving it. */
export const roomControlsModel = (
  channel: AsRead.Channel,
  roster: Roster | null,
  viewerId: MemberId | null,
  viewerIsAdmin = false,
): RoomControls => {
  const facts = rosterFacts(roster, viewerId)
  const seesMembers = channel.managing || (viewerIsAdmin && isPrivate(channel))
  return {
    answering: channel.joined ? answeringModel(channel) : null,
    manage: seesMembers ? strings.membersTitle({ channel: channelLabel(channel.slug) }) : null,
    leave: !channel.joined
      ? null
      : facts.viewerIsLastManager
        ? { kind: 'blocked', reason: strings.lastManagerCannotLeave }
        : { kind: 'allowed', title: strings.leaveChannelTitle({ channel: channelLabel(channel.slug) }) },
    leaveBody: leaveConsequence(channel),
  }
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
  checked: channel.answering,
  state: channel.answering ? strings.switchOn : strings.switchOff,
})

/** The members panel: one row per member with what may be changed, adding members, and the visibility. */
export const membersPanelModel = (input: MembersPanelInput): MembersPanelModel => {
  const roster = input.roster
  const managedByAdmin =
    !input.viewerIsAdmin || input.channel.joined
      ? null
      : input.channel.managing
        ? strings.managedByAdmin
        : strings.seenByAdmin
  if (roster === null) return { managedByAdmin, rows: null, addMember: null, visibility: null }
  if (!input.channel.managing) return seenByAdministrator(input, roster, managedByAdmin)
  const facts = rosterFacts({ memberCount: roster.length, members: roster }, input.viewerId)
  const inside = new Set(roster.map((member) => member.memberId))
  const candidates = input.directory.filter((entry) => !inside.has(entry.member.id))
  const toPrivate = !isPrivate(input.channel)
  return {
    managedByAdmin,
    rows: roster.map((member) =>
      member.memberId === input.viewerId
        ? ownRow(input, member, facts.viewerIsLastManager)
        : memberRow(input, member, facts.lastManagerId === member.memberId && roster.length > 1),
    ),
    addMember: !isPrivate(input.channel)
      ? null
      : candidates.length === 0
        ? { kind: 'nobody', text: strings.nobodyToAdd }
        : {
            kind: 'choose',
            choices: candidates.map((entry) => ({
              value: entry.member.id,
              label: `${entry.member.name} · ${entry.member.email}`,
            })),
          },
    visibility: {
      current: isPrivate(input.channel) ? strings.visibilityPrivate : strings.visibilityOpen,
      change: isPrivate(input.channel)
        ? { kind: 'allowed', label: strings.makeOpen }
        : facts.hasManager
          ? { kind: 'allowed', label: strings.makePrivate }
          : { kind: 'blocked', label: strings.makePrivate, reason: strings.privateNeedsManager },
      confirmation: visibilityConfirmation(input.channel, toPrivate),
    },
  }
}

/** What leaving a channel means: a private one cannot be rejoined without being added again. */
export const leaveConsequence = (channel: AsRead.Channel): string =>
  isPrivate(channel)
    ? strings.leavePrivateChannelBody({ channel: channelLabel(channel.slug) })
    : strings.leaveChannelBody

export interface RoomControls {
  readonly answering: AnsweringModel | null
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
}

export interface MembersPanelModel {
  readonly managedByAdmin: string | null
  readonly rows: ReadonlyArray<MemberRow> | null
  readonly addMember:
    | { readonly kind: 'nobody'; readonly text: string }
    | {
        readonly kind: 'choose'
        readonly choices: ReadonlyArray<{ readonly value: MemberId; readonly label: string }>
      }
    | null
  readonly visibility: {
    readonly current: string
    readonly change:
      | { readonly kind: 'allowed'; readonly label: string }
      | { readonly kind: 'blocked'; readonly label: string; readonly reason: string }
    readonly confirmation: Confirmation
  } | null
}

export type MemberRow =
  | {
      readonly kind: 'own'
      readonly memberId: MemberId
      readonly name: string
      readonly roles: ReadonlyArray<Role>
      readonly blocked: string | null
      readonly stepDown: Confirmation | null
      readonly leave: Confirmation
    }
  | {
      readonly kind: 'other'
      readonly memberId: MemberId
      readonly name: string
      readonly roles: ReadonlyArray<Role>
      readonly manager: { readonly label: string; readonly makes: boolean } | null
      readonly remove: string | null
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

const ownRow = (input: MembersPanelInput, member: ChannelMember, isLastManager: boolean): MemberRow => {
  const label = channelLabel(input.channel.slug)
  return {
    kind: 'own',
    memberId: member.memberId,
    name: nameIn(input, member.memberId),
    roles: roles(member),
    blocked: isLastManager ? strings.lastManagerOwnRow : null,
    stepDown: member.manager
      ? {
          title: strings.stepDownTitle({ channel: label }),
          body: strings.stepDownBody({ channel: label }),
          confirm: strings.stepDown,
        }
      : null,
    leave: {
      title: strings.leaveChannelTitle({ channel: label }),
      body: leaveConsequence(input.channel),
      confirm: strings.leaveChannel,
    },
  }
}

const memberRow = (
  input: MembersPanelInput,
  member: ChannelMember,
  keepsTheChannelManaged: boolean,
): MemberRow => ({
  kind: 'other',
  memberId: member.memberId,
  name: nameIn(input, member.memberId),
  roles: roles(member),
  manager: keepsTheChannelManaged
    ? null
    : { label: member.manager ? strings.revokeManager : strings.makeManager, makes: !member.manager },
  remove: isPrivate(input.channel) && !keepsTheChannelManaged ? strings.removeMember : null,
})

/**
 * An administrator outside a private channel sees who is in it and may remove people, as the server
 * allows, but never adds a member, makes a manager or opens the channel: only its managers do that.
 */
const seenByAdministrator = (
  input: MembersPanelInput,
  roster: ReadonlyArray<ChannelMember>,
  managedByAdmin: string | null,
): MembersPanelModel => {
  const facts = rosterFacts({ memberCount: roster.length, members: roster }, input.viewerId)
  return {
    managedByAdmin,
    rows: roster.map((member) => ({
      ...memberRow(input, member, facts.lastManagerId === member.memberId && roster.length > 1),
      manager: null,
    })),
    addMember: null,
    visibility: null,
  }
}

const visibilityConfirmation = (channel: AsRead.Channel, toPrivate: boolean): Confirmation => {
  const label = channelLabel(channel.slug)
  return toPrivate
    ? {
        title: strings.makePrivateTitle({ channel: label }),
        body: strings.makePrivateBody({ count: channel.memberCount, channel: label }),
        confirm: strings.confirmMakePrivate,
      }
    : {
        title: strings.makeOpenTitle({ channel: label }),
        body: strings.makeOpenBody({ channel: label }),
        confirm: strings.confirmMakeOpen,
      }
}

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
import { groupLabel, groupsOf } from '../groups.ts'
import { type AdminSection, hrefFor } from '../routes.ts'
import { listOf, strings } from '../strings.ts'

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

/** Administration → Members: each member's role and status, and what may be changed for them. */
export const adminMembersModel = (
  members: ReadonlyArray<AsRead.Member> | null,
  viewerId: string,
  charactersOn: boolean,
): AdminMembersModel =>
  members === null
    ? null
    : members.map((member) => ({
        member,
        isYou: member.id === viewerId,
        role: { className: `kind is-${member.role}`, text: strings.memberRole[member.role] },
        status: { className: `kind is-${member.status}`, text: strings.memberStatus[member.status] },
        actions:
          member.id === viewerId
            ? []
            : [
                ...(member.role === 'admin' ? [memberAction('make-member', strings.makeMember)] : []),
                ...(member.role === 'member' ? [memberAction('make-admin', strings.makeAdmin)] : []),
                ...(member.status === 'active'
                  ? [memberAction('deactivate', strings.deactivate, 'danger')]
                  : []),
                ...(member.status === 'deactivated' ? [memberAction('reactivate', strings.reactivate)] : []),
                ...(member.character != null && charactersOn
                  ? [memberAction('reset-character', strings.character.resetMember)]
                  : []),
              ],
      }))

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

export type AdminMembersModel = ReadonlyArray<{
  readonly member: AsRead.Member
  readonly isYou: boolean
  readonly role: { readonly className: string; readonly text: string }
  readonly status: { readonly className: string; readonly text: string }
  readonly actions: ReadonlyArray<{
    readonly kind: MemberActionKind
    readonly label: string
    readonly danger: boolean
  }>
}> | null

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

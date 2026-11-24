import { type AsRead, type MemberId, RECIPIENTS_MAX, isPerson } from '@homingbird/protocol'
import { groupById, groupLabel } from '../groups.ts'
import { hrefFor } from '../routes.ts'
import type { Workspace } from '../state.ts'
import { strings } from '../strings.ts'
import { groupWith } from '../thread.ts'
import { type AvatarModel, memberAvatarOf } from './avatar.ts'
import { type ListStep, type ListWait, listWaitModel } from './start.ts'

/**
 * A team's page: its name, who is in it, writing to one of them or to all of them at once, and, only where
 * the person may change it, renaming it and adding or removing people. A channel's managers are shown with
 * the channel instead.
 */
export const groupPageModel = (input: GroupPageInput): GroupPageModel => {
  if (input.awaited !== null)
    return { kind: 'waiting', wait: listWaitModel(input.awaited, input.workspace, strings.loading) }
  const group = groupById(input.groups, input.id)
  if (group === null || group.kind !== 'team') return { kind: 'missing', text: strings.notFound }
  const title = groupLabel(group)
  const inside = new Set(group.memberIds)
  const candidates = input.directory.filter(
    (entry) => !inside.has(entry.member.id) && entry.member.status === 'active',
  )
  const messageable = new Set(
    input.directory
      .filter((entry) => entry.canMessage && isPerson(entry.member) && entry.member.id !== input.viewerId)
      .map((entry) => entry.member.id),
  )
  return {
    kind: 'group',
    group,
    title,
    membersHeading: strings.groups.membersOf({ group: title }),
    members: group.memberIds
      .map((memberId) => memberRow(input, group, memberId, messageable))
      .sort((a, b) => a.name.localeCompare(b.name)),
    groupMessage: groupMessage(
      input,
      title,
      group.memberIds.filter((memberId) => messageable.has(memberId)),
    ),
    rename: group.mayAdd ? { label: strings.groups.rename, value: group.name ?? '' } : null,
    addMember:
      !group.mayAdd || candidates.length === 0
        ? null
        : {
            label: strings.addMemberLabel,
            choices: candidates.map((entry) => ({
              value: entry.member.id,
              label: `${entry.member.name} · ${entry.member.email}`,
            })),
          },
  }
}

/** The name typed in a team's form as the server takes it, without surrounding space. */
export const groupNameFrom = (typed: string): string => typed.trim()

export interface GroupPageInput {
  readonly id: string
  readonly groups: ReadonlyArray<AsRead.Group>
  /** How the first answer of the groups is going, or null once they have come. */
  readonly awaited: ListStep | null
  readonly workspace: Workspace
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly viewerId: MemberId
  readonly charactersOn: boolean
}

export type GroupPageModel =
  | { readonly kind: 'waiting'; readonly wait: ListWait }
  | { readonly kind: 'missing'; readonly text: string }
  | {
      readonly kind: 'group'
      readonly group: AsRead.Group
      readonly title: string
      readonly membersHeading: string
      readonly members: ReadonlyArray<GroupMemberRow>
      /** Writing to everyone else in the team at once: the group message there is, or a new one. */
      readonly groupMessage: GroupMessage | null
      readonly rename: { readonly label: string; readonly value: string } | null
      readonly addMember: {
        readonly label: string
        readonly choices: ReadonlyArray<{ readonly value: MemberId; readonly label: string }>
      } | null
    }

export interface GroupMemberRow {
  readonly memberId: MemberId
  readonly avatar: AvatarModel
  readonly name: string
  readonly isYou: boolean
  /** The label of the tile's button that opens a direct message, where the person may write to them. */
  readonly message: string | null
  readonly remove: string | null
}

export interface GroupMessage {
  readonly label: string
  readonly memberIds: ReadonlyArray<MemberId>
  readonly href: string | null
}

const memberRow = (
  input: GroupPageInput,
  group: AsRead.Group,
  memberId: MemberId,
  messageable: ReadonlySet<MemberId>,
): GroupMemberRow => {
  const member = input.members.get(memberId)
  const name = member?.name ?? strings.formerMember
  return {
    memberId,
    avatar: memberAvatarOf(member, input.charactersOn),
    name,
    isYou: memberId === input.viewerId,
    message: messageable.has(memberId) ? strings.groups.writeTo({ name }) : null,
    remove: group.mayRemove ? strings.removeMember : null,
  }
}

const groupMessage = (
  input: GroupPageInput,
  title: string,
  memberIds: ReadonlyArray<MemberId>,
): GroupMessage | null => {
  if (memberIds.length < 2 || memberIds.length > RECIPIENTS_MAX) return null
  const existing = groupWith(input.conversations, input.viewerId, memberIds)
  return existing === undefined
    ? { label: strings.groups.messageGroup({ group: title }), memberIds, href: null }
    : {
        label: strings.groups.openGroupMessage({ group: title }),
        memberIds,
        href: hrefFor({ name: 'conversation', id: existing.id, draft: null }),
      }
}

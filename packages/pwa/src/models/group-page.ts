import type { AsRead, MemberId } from '@homingbird/protocol'
import { groupById, groupLabel } from '../groups.ts'
import { strings } from '../strings.ts'
import { type AvatarModel, memberAvatarOf } from './avatar.ts'

/**
 * A team's page: its name, who is in it, and, only where the person may change it, renaming it and adding
 * or removing people. A channel's managers are shown with the channel instead.
 */
export const groupPageModel = (input: GroupPageInput): GroupPageModel => {
  if (!input.loaded) return input.failed ? { kind: 'failed' } : { kind: 'loading' }
  const group = groupById(input.groups, input.id)
  if (group === null || group.kind !== 'team') return { kind: 'missing', text: strings.notFound }
  const title = groupLabel(group)
  const inside = new Set(group.memberIds)
  const candidates = input.directory.filter(
    (entry) => !inside.has(entry.member.id) && entry.member.status === 'active',
  )
  return {
    kind: 'group',
    group,
    title,
    membersHeading: strings.groups.membersOf({ group: title }),
    members: group.memberIds
      .map((memberId) => memberRow(input, group, memberId))
      .sort((a, b) => a.name.localeCompare(b.name)),
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
  readonly loaded: boolean
  readonly failed: boolean
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly viewerId: MemberId
  readonly charactersOn: boolean
}

export type GroupPageModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'missing'; readonly text: string }
  | {
      readonly kind: 'group'
      readonly group: AsRead.Group
      readonly title: string
      readonly membersHeading: string
      readonly members: ReadonlyArray<GroupMemberRow>
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
  readonly remove: string | null
}

const memberRow = (input: GroupPageInput, group: AsRead.Group, memberId: MemberId): GroupMemberRow => {
  const member = input.members.get(memberId)
  return {
    memberId,
    avatar: memberAvatarOf(member, input.charactersOn),
    name: member?.name ?? strings.formerMember,
    isYou: memberId === input.viewerId,
    remove: group.mayRemove ? strings.removeMember : null,
  }
}

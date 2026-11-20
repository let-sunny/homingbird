import type { AsRead, GroupId, MemberId } from '@homingbird/protocol'
import { channelLabel } from './channels.ts'
import { listOf, strings } from './strings.ts'

/**
 * What a group is called for the person: a team by its name, a channel's group as "Managers of #slug",
 * and a group of a kind this client does not know as "Unnamed group".
 */
export const groupLabel = (group: AsRead.Group): string => {
  if (group.kind === 'team' && group.name !== null) return group.name
  const channel = group.kind === 'channel' ? group.channels[0] : undefined
  return channel === undefined
    ? strings.groups.unnamed
    : strings.groups.managersOf({ channel: channelLabel(channel) })
}

/** The group with this id, or null when the person cannot see one. */
export const groupById = (
  groups: ReadonlyArray<AsRead.Group>,
  id: GroupId | string | null,
): AsRead.Group | null => groups.find((group) => group.id === id) ?? null

/** Every team, by name: the groups shown in lists, filters and profiles. */
export const teamsByLabel = (groups: ReadonlyArray<AsRead.Group>): AsRead.Group[] =>
  groups.filter(isTeam).sort(byLabel)

/** The teams a member is in, by name. */
export const teamsOf = (groups: ReadonlyArray<AsRead.Group>, memberId: MemberId | null): AsRead.Group[] =>
  teamsByLabel(groups).filter((group) => memberId !== null && group.memberIds.includes(memberId))

/** Every group a member is in, teams and channels' managers, by what they are called. */
export const groupsOf = (groups: ReadonlyArray<AsRead.Group>, memberId: MemberId | null): AsRead.Group[] =>
  groups.filter((group) => memberId !== null && group.memberIds.includes(memberId)).sort(byLabel)

/** The channels a member manages, of those the person can see: the channels whose managers they are. */
export const channelsManagedBy = (groups: ReadonlyArray<AsRead.Group>, memberId: MemberId | null): string[] =>
  groupsOf(groups, memberId)
    .filter((group) => group.kind === 'channel')
    .flatMap((group) => group.channels)
    .sort()

/** Which channels someone manages, in one sentence. */
export const managesText = (slugs: ReadonlyArray<string>): string =>
  slugs.length === 0 ? strings.groups.managesNone : strings.groups.manages({ channels: channelList(slugs) })

/** Channel names as one list in the person's language: "#a, #b and #c". */
export const channelList = (slugs: ReadonlyArray<string>): string => listOf(slugs.map(channelLabel))

const isTeam = (group: AsRead.Group): boolean => group.kind === 'team'

const byLabel = (a: AsRead.Group, b: AsRead.Group): number => groupLabel(a).localeCompare(groupLabel(b))

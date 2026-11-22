import type { AsRead, MemberId } from '@homingbird/protocol'
import { type ChannelAgentState, channelAgentState } from '../channel-answerers.ts'
import { channelLabel } from '../channels.ts'
import { groupById, groupLabel, teamsOf } from '../groups.ts'
import { type PresenceMarks, presenceMarks } from '../presence.ts'
import { type Route, hrefFor } from '../routes.ts'
import { listOf, strings } from '../strings.ts'
import { type AvatarModel, memberAvatarOf } from './avatar.ts'
import { conversationParticipants, debateParticipants } from './participants.ts'

/**
 * The card behind a name: who they are, whether they and their agent are here, their teams and what they
 * are in the place the card opened from, and a way to write to them. A channel's agent cannot be written
 * to, so its card names its channel and managers instead; someone who left has a card with no actions.
 * It shows only what the directory, the channels and the groups already give the viewer.
 */
export const profileCardModel = (input: ProfileCardInput): ProfileCard => {
  const member = input.members.get(input.memberId)
  const owned = channelOwning(input)
  if (owned !== null) return agentCard(input, member, owned.agent.name, owned)
  if (member !== undefined && member.kind !== 'person') return agentCard(input, member, member.name, null)
  if (member === undefined || member.status === 'deactivated') return formerCard(input, member)
  return personCard(input, member)
}

export interface ProfileCardInput {
  readonly memberId: MemberId
  readonly viewerId: MemberId
  readonly route: Route
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly groups: ReadonlyArray<AsRead.Group>
  readonly groupsOn: boolean
  readonly charactersOn: boolean
  readonly debate: AsRead.Debate | 'missing' | null
  /** What the place the card opened from says about one of its notes, when it opened from a note's author. */
  readonly note: ReadonlyArray<string>
}

export type ProfileCard = PersonProfile | AgentProfile | FormerProfile

interface ProfileBase {
  readonly memberId: MemberId
  /** What the card is called for assistive technology. */
  readonly label: string
  readonly avatar: AvatarModel
  readonly name: string
  /** What they are in the place the card opened from: the asker, a manager, who opened the room. */
  readonly roles: ReadonlyArray<string>
  readonly note: ProfileNote | null
}

export interface PersonProfile extends ProfileBase {
  readonly kind: 'person'
  readonly you: boolean
  readonly presence: PresenceMarks | null
  readonly teams: string | null
  readonly about: string | null
  /** The direct message with them, or the new-message screen with them chosen while there is none. */
  readonly message: { readonly label: string; readonly href: string } | null
  readonly people: { readonly label: string; readonly href: string }
}

export interface AgentProfile extends ProfileBase {
  readonly kind: 'agent'
  /** “Agent of #billing”. */
  readonly of: string
  readonly state: ChannelAgentState | null
  readonly managers: string | null
}

export interface FormerProfile extends ProfileBase {
  readonly kind: 'former'
  /** “Former member”, unless the name already says it. */
  readonly line: string | null
}

export interface ProfileNote {
  readonly title: string
  readonly lines: ReadonlyArray<string>
}

const personCard = (input: ProfileCardInput, member: AsRead.Member): PersonProfile => {
  const entry = input.directory.find((candidate) => candidate.member.id === member.id)
  const you = member.id === input.viewerId
  const teams = input.groupsOn ? teamsOf(input.groups, member.id).map(groupLabel) : []
  return {
    ...base(input, member, member.name),
    kind: 'person',
    you,
    presence: entry === undefined ? null : presenceMarks(entry.presence, member.name),
    teams: teams.length === 0 ? null : strings.profileCard.groups({ groups: listOf(teams) }),
    about: member.profile.trim() === '' ? null : member.profile,
    message:
      !you && entry?.canMessage === true && entry.relation !== 'blocked'
        ? { label: strings.message, href: messageHref(input, member.id) }
        : null,
    people: { label: strings.profileCard.openInPeople, href: hrefFor({ name: 'people', person: member.id }) },
  }
}

const agentCard = (
  input: ProfileCardInput,
  member: AsRead.Member | undefined,
  name: string,
  owned: OwnedAgent | null,
): AgentProfile => {
  const managers = owned === null ? [] : managerNames(input, owned.channel)
  const of =
    owned === null
      ? strings.participants.agent
      : strings.participants.channelAgent({ channel: channelLabel(owned.channel.slug) })
  const shown = base(input, member, name)
  return {
    ...shown,
    kind: 'agent',
    roles: shown.roles.filter((role) => role !== of),
    of,
    state: owned === null ? null : channelAgentState(owned.agent),
    managers: managers.length === 0 ? null : strings.profileCard.managedBy({ names: listOf(managers) }),
  }
}

interface OwnedAgent {
  readonly channel: AsRead.Channel
  readonly agent: NonNullable<AsRead.Channel['agent']>
}

/** The channel whose own agent the member is, of the channels the viewer may see. */
const channelOwning = (input: ProfileCardInput): OwnedAgent | null => {
  for (const channel of input.channels)
    if (channel.agent != null && channel.agent.id === input.memberId) return { channel, agent: channel.agent }
  return null
}

const formerCard = (input: ProfileCardInput, member: AsRead.Member | undefined): FormerProfile => {
  const name = member?.name ?? strings.formerMember
  return {
    ...base(input, member, name),
    kind: 'former',
    roles: [],
    line: name === strings.formerMember ? null : strings.formerMember,
  }
}

const base = (input: ProfileCardInput, member: AsRead.Member | undefined, name: string): ProfileBase => ({
  memberId: input.memberId,
  label: strings.profileCard.label({ name }),
  avatar: memberAvatarOf(member, input.charactersOn, { labelled: false }),
  name,
  roles: rolesHere(input),
  note: input.note.length === 0 ? null : { title: strings.profileCard.thisNote, lines: input.note },
})

/** The member's part in the room or debate the route shows, as its list of who is here names it. */
const rolesHere = (input: ProfileCardInput): ReadonlyArray<string> => {
  const route = input.route
  const here =
    route.name === 'conversation'
      ? conversationHere(input, route.id)
      : route.name === 'debate' && input.debate !== null && input.debate !== 'missing'
        ? debateParticipants(input.debate, input.viewerId, (memberId) => nameOf(input, memberId))
        : null
  return here?.people.find((person) => person.memberId === input.memberId)?.roles ?? []
}

const conversationHere = (input: ProfileCardInput, id: string) => {
  const conversation = input.conversations.find((candidate) => candidate.id === id)
  return conversation === undefined
    ? null
    : conversationParticipants({
        conversation,
        viewerId: input.viewerId,
        members: input.members,
        channels: input.channels,
      })
}

/**
 * Who manages the agent's channel: the members of its managing group when the viewer may see that group,
 * and the managers the room on screen names, which only its participants are told.
 */
const managerNames = (input: ProfileCardInput, channel: AsRead.Channel): ReadonlyArray<string> => {
  const route = input.route
  const room =
    route.name === 'conversation'
      ? input.conversations.find((candidate) => candidate.id === route.id)
      : undefined
  const fromRoom =
    room !== undefined && (room.id === channel.conversationId || room.privateQuestionOf === channel.slug)
      ? (room.managerIds ?? [])
      : []
  const ids = new Set([...(groupById(input.groups, channel.managedBy)?.memberIds ?? []), ...fromRoom])
  return [...ids].flatMap((memberId) => {
    const member = input.members.get(memberId)
    return member === undefined ? [] : [member.name]
  })
}

const messageHref = (input: ProfileCardInput, memberId: MemberId): string => {
  const direct = input.conversations.find(
    (candidate) =>
      candidate.kind === 'direct' &&
      candidate.archivedAt === null &&
      candidate.participantIds.includes(memberId) &&
      candidate.participantIds.includes(input.viewerId),
  )
  return direct === undefined
    ? hrefFor({ name: 'new', to: [memberId] })
    : hrefFor({ name: 'conversation', id: direct.id, draft: null })
}

const nameOf = (input: ProfileCardInput, memberId: MemberId): string =>
  input.members.get(memberId)?.name ?? strings.formerMember

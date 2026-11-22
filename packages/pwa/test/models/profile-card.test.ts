import type { ConversationId, MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { type ProfileCardInput, profileCardModel } from '../../src/models/profile-card.ts'
import { strings } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CY,
  TEAM,
  channel,
  conversation,
  debate,
  entry,
  group,
  managersOf,
  member,
} from '../support/fixtures.ts'

const AGENT = 'mem_agent0000000' as MemberId
const GONE = 'mem_gone00000000' as MemberId

const billing = channel('billing', {
  agent: { id: AGENT, name: 'Billing helper', presence: { humanOnline: false, agentOnline: true } },
})

const input = (fields: Partial<ProfileCardInput> = {}): ProfileCardInput => ({
  memberId: BEN,
  viewerId: ANA,
  route: { name: 'people' },
  members: new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben', { profile: 'Runs billing.' })],
    [CY, member(CY, 'Cy', { status: 'deactivated' })],
    [AGENT, member(AGENT, 'Billing helper', { kind: 'channel_agent' })],
  ]),
  directory: [entry(ANA, 'Ana'), entry(BEN, 'Ben', { presence: { humanOnline: true, agentOnline: true } })],
  conversations: [],
  channels: [billing],
  groups: [group(TEAM, { name: 'Payments', memberIds: [ANA, BEN] })],
  groupsOn: true,
  charactersOn: false,
  debate: null,
  note: [],
  ...fields,
})

describe('profileCardModel', () => {
  it('shows a colleague with their presence, their teams, what they wrote about themself and a way to write to them', () => {
    expect(profileCardModel(input())).toEqual({
      kind: 'person',
      memberId: BEN,
      label: strings.profileCard.label({ name: 'Ben' }),
      avatar: expect.objectContaining({ label: null }),
      name: 'Ben',
      you: false,
      roles: [],
      note: null,
      presence: expect.objectContaining({ words: strings.presenceWords.online.on }),
      teams: strings.profileCard.groups({ groups: 'Payments' }),
      about: 'Runs billing.',
      message: { label: strings.message, href: `#/new?to=${BEN}` },
      people: { label: strings.profileCard.openInPeople, href: `#/people?person=${BEN}` },
    })
  })

  it('offers no Message to the person themself, to someone blocked, or to someone who takes no notes from them', () => {
    expect(profileCardModel(input({ memberId: ANA }))).toMatchObject({
      you: true,
      message: null,
      about: null,
    })
    const blocked = input({ directory: [entry(BEN, 'Ben', { relation: 'blocked' })] })
    expect(profileCardModel(blocked)).toMatchObject({ message: null })
    const closed = input({ directory: [entry(BEN, 'Ben', { canMessage: false })] })
    expect(profileCardModel(closed)).toMatchObject({ message: null })
    expect(profileCardModel(input({ directory: [] }))).toMatchObject({ message: null, presence: null })
  })

  it('opens the direct message with them where there is one, and starts a new one where there is none', () => {
    const direct = conversation({ id: 'conv_dm000000000' as ConversationId })
    const message = (conversations: ReturnType<typeof conversation>[]) =>
      (profileCardModel(input({ conversations })) as { message: { href: string } }).message.href
    expect(message([direct])).toBe(`#/c/${direct.id}`)
    expect(message([{ ...direct, archivedAt: 5 }])).toBe(`#/new?to=${BEN}`)
    expect(message([{ ...direct, kind: 'group', participantIds: [ANA, BEN, CY] }])).toBe(`#/new?to=${BEN}`)
    expect(message([{ ...direct, participantIds: [BEN, CY] }])).toBe(`#/new?to=${BEN}`)
    expect(message([{ ...direct, participantIds: [ANA, CY] }])).toBe(`#/new?to=${BEN}`)
  })

  it('names no team while groups are off or the colleague is in none', () => {
    expect(profileCardModel(input({ groupsOn: false }))).toMatchObject({ teams: null })
    expect(profileCardModel(input({ groups: [] }))).toMatchObject({ teams: null })
  })

  it('gives a channel’s agent no Message: it names its channel, its state and the managers the viewer may see', () => {
    const room = conversation({
      id: billing.conversationId,
      kind: 'channel',
      participantIds: [ANA, BEN, AGENT],
      managerIds: [BEN, GONE],
    })
    const card = profileCardModel(
      input({
        memberId: AGENT,
        route: { name: 'conversation', id: billing.conversationId, draft: null },
        conversations: [room],
        groups: [managersOf('billing', { memberIds: [ANA] })],
      }),
    )
    expect(card).toEqual({
      kind: 'agent',
      memberId: AGENT,
      label: strings.profileCard.label({ name: 'Billing helper' }),
      avatar: expect.objectContaining({ label: null }),
      name: 'Billing helper',
      roles: [],
      note: null,
      of: strings.participants.channelAgent({ channel: '#billing' }),
      state: expect.objectContaining({ state: 'on' }),
      managers: strings.profileCard.managedBy({ names: 'Ana and Ben' }),
    })
    expect(card).not.toHaveProperty('message')
  })

  it('names the managers of a private question’s channel to its participants, and none it may not see', () => {
    const question = conversation({ id: 'conv_q00000000000' as ConversationId, privateQuestionOf: 'billing' })
    const shown = (fields: Partial<ProfileCardInput>) =>
      profileCardModel(input({ memberId: AGENT, groups: [], ...fields }))
    expect(
      shown({
        route: { name: 'conversation', id: question.id, draft: null },
        conversations: [{ ...question, managerIds: [BEN] }],
      }),
    ).toMatchObject({ managers: strings.profileCard.managedBy({ names: 'Ben' }) })
    expect(
      shown({ route: { name: 'conversation', id: question.id, draft: null }, conversations: [question] }),
    ).toMatchObject({ managers: null })
    expect(
      shown({
        route: { name: 'conversation', id: question.id, draft: null },
        conversations: [{ ...question, privateQuestionOf: 'other', managerIds: [BEN] }],
      }),
    ).toMatchObject({ managers: null })
    expect(shown({})).toMatchObject({ managers: null })
  })

  it('shows a member who is not a person as an agent of no known channel', () => {
    expect(profileCardModel(input({ memberId: AGENT, channels: [channel('billing')] }))).toMatchObject({
      kind: 'agent',
      name: 'Billing helper',
      of: strings.participants.agent,
      state: null,
      managers: null,
    })
  })

  it('shows someone who left as a former member with nothing to do', () => {
    expect(profileCardModel(input({ memberId: CY }))).toMatchObject({
      kind: 'former',
      name: 'Cy',
      line: strings.formerMember,
      roles: [],
    })
    expect(profileCardModel(input({ memberId: GONE }))).toEqual({
      kind: 'former',
      memberId: GONE,
      label: strings.profileCard.label({ name: strings.formerMember }),
      avatar: expect.objectContaining({ label: null }),
      name: strings.formerMember,
      roles: [],
      note: null,
      line: null,
    })
  })

  it('says what the member is in the room or the debate room on screen, and nothing elsewhere', () => {
    const question = conversation({ privateQuestionOf: 'billing', askedBy: BEN, participantIds: [ANA, BEN] })
    const inRoom = { name: 'conversation', id: question.id, draft: null } as const
    expect(profileCardModel(input({ route: inRoom, conversations: [question] }))).toMatchObject({
      roles: [strings.participants.asker],
    })
    expect(profileCardModel(input({ route: inRoom }))).toMatchObject({ roles: [] })
    const room = debate({
      participants: [{ memberId: BEN, agentId: null, agentName: 'Desk', joinedAt: 1 }],
    })
    const inDebate = { name: 'debate', id: room.id, tab: null } as const
    expect(profileCardModel(input({ route: inDebate, debate: room }))).toMatchObject({
      roles: [strings.participants.takesPartThrough({ agent: 'Desk' })],
    })
    expect(
      profileCardModel(
        input({
          memberId: ANA,
          route: inDebate,
          debate: debate({
            participants: [{ memberId: GONE, agentId: null, agentName: 'Desk', joinedAt: 1 }],
          }),
        }),
      ),
    ).toMatchObject({ roles: [] })
    expect(profileCardModel(input({ route: inDebate, debate: 'missing' }))).toMatchObject({ roles: [] })
    expect(profileCardModel(input({ route: inDebate }))).toMatchObject({ roles: [] })
  })

  it('carries what the note it opened from says about how it was written', () => {
    expect(profileCardModel(input({ note: ['Ben’s agent wrote this', 'Sent at noon'] }))).toMatchObject({
      note: { title: strings.profileCard.thisNote, lines: ['Ben’s agent wrote this', 'Sent at noon'] },
    })
  })
})

import type { MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { conversationParticipants, debateParticipants } from '../../src/models/participants.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, ROOM, channel, conversation, debate, member } from '../support/fixtures.ts'

const AGENT = 'mem_agent0000000' as MemberId
const DEE = 'mem_dee000000000' as MemberId
const GONE = 'mem_gone00000000' as MemberId

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
  [CY, member(CY, 'Cy')],
  [DEE, member(DEE, 'Dee')],
  [AGENT, member(AGENT, 'Billing helper', { kind: 'channel_agent' })],
])

const billing = channel('billing', {
  conversationId: 'conv_billing0000' as never,
  agent: {
    id: AGENT,
    name: 'Billing helper',
    presence: { humanOnline: false, agentOnline: true, agentUnavailable: { until: null } },
  },
})

const listed = (model: ReturnType<typeof conversationParticipants>) =>
  model.people.map((person) => [person.name, person.you, person.roles])

describe('conversationParticipants', () => {
  it('names everyone in a private question with their part, the person first, and that later managers join', () => {
    const question = conversation({
      kind: 'group',
      participantIds: [CY, AGENT, ANA, BEN],
      privateQuestionOf: 'billing',
      askedBy: BEN,
      managerIds: [ANA, CY],
    })
    const model = conversationParticipants({
      conversation: question,
      viewerId: ANA,
      members,
      channels: [billing],
    })
    expect(listed(model)).toEqual([
      ['Ana', true, [strings.participants.manager({ channel: '#billing' })]],
      ['Ben', false, [strings.participants.asker]],
      ['Billing helper', false, [strings.participants.channelAgent({ channel: '#billing' })]],
      ['Cy', false, [strings.participants.manager({ channel: '#billing' })]],
    ])
    expect(model).toMatchObject({
      id: `people-${ROOM}`,
      label: strings.groupPeople({ count: 4 }),
      title: strings.participants.title,
      summary: 'Ana, Ben, Billing helper, and Cy',
      note: strings.participants.laterManagers({ channel: '#billing' }),
    })
  })

  it('shows an asker who also manages the channel with both parts', () => {
    const question = conversation({
      kind: 'group',
      participantIds: [ANA, AGENT],
      privateQuestionOf: 'billing',
      askedBy: ANA,
      managerIds: [ANA],
    })
    const model = conversationParticipants({
      conversation: question,
      viewerId: ANA,
      members,
      channels: [billing],
    })
    expect(model.people[0]!.roles).toEqual([
      strings.participants.asker,
      strings.participants.manager({ channel: '#billing' }),
    ])
  })

  it('names the agent and managers of a closed question without its channel, and promises no later readers', () => {
    const closed = conversation({
      kind: 'group',
      participantIds: [ANA, AGENT, GONE],
      privateQuestionOf: null,
      askedBy: ANA,
      managerIds: [GONE],
      archivedAt: 5,
    })
    const model = conversationParticipants({ conversation: closed, viewerId: ANA, members, channels: [] })
    expect(listed(model)).toEqual([
      ['Ana', true, [strings.participants.asker]],
      ['Billing helper', false, [strings.participants.agent]],
      [strings.formerMember, false, []],
    ])
    expect(model.note).toBeNull()
  })

  it('names a channel room’s agent and managers, and titles the list with the channel', () => {
    const room = conversation({
      id: billing.conversationId,
      kind: 'channel',
      title: 'billing',
      participantIds: [BEN, ANA, AGENT, DEE],
      managerIds: [DEE],
    })
    const model = conversationParticipants({
      conversation: room,
      viewerId: ANA,
      members,
      channels: [billing],
    })
    expect(listed(model)).toEqual([
      ['Ana', true, []],
      ['Billing helper', false, [strings.participants.channelAgent({ channel: '#billing' })]],
      ['Dee', false, [strings.participants.manager({ channel: '#billing' })]],
      ['Ben', false, []],
    ])
    expect(model.title).toBe(strings.participants.inChannel({ channel: '#billing' }))
    expect(model.note).toBeNull()
    const unknown = conversationParticipants({ conversation: room, viewerId: ANA, members, channels: [] })
    expect(unknown.title).toBe(strings.participants.title)
    expect(unknown.people.every((person) => !person.roles.some((role) => role.includes('Manages')))).toBe(
      true,
    )
  })

  it('lists a direct or group message’s people with no parts but the person’s own', () => {
    const model = conversationParticipants({
      conversation: conversation({ kind: 'group', participantIds: [BEN, ANA, CY] }),
      viewerId: ANA,
      members,
      channels: [billing],
    })
    expect(listed(model)).toEqual([
      ['Ana', true, []],
      ['Ben', false, []],
      ['Cy', false, []],
    ])
    expect(model.label).toBe(strings.groupPeople({ count: 3 }))
  })
})

describe('debateParticipants', () => {
  it('lists the person’s own agent first, each with the agent it takes part through and who opened the room', () => {
    const room = debate({
      createdBy: BEN,
      participants: [
        { memberId: BEN, agentId: null, agentName: 'Ben’s helper', joinedAt: 1 },
        { memberId: ANA, agentId: null, agentName: 'Scout', joinedAt: 2 },
      ],
    })
    const model = debateParticipants(room, ANA, (memberId) => members.get(memberId)?.name ?? '')
    expect(model.people).toEqual([
      {
        memberId: ANA,
        name: 'Ana',
        you: true,
        roles: [strings.participants.takesPartThrough({ agent: 'Scout' })],
      },
      {
        memberId: BEN,
        name: 'Ben',
        you: false,
        roles: [
          strings.participants.takesPartThrough({ agent: 'Ben’s helper' }),
          strings.participants.openedRoom,
        ],
      },
    ])
    expect(model).toMatchObject({
      id: `people-${room.id}`,
      label: strings.groupPeople({ count: 2 }),
      title: strings.participants.inRoom,
      summary: 'Ana and Ben',
      note: null,
    })
  })
})

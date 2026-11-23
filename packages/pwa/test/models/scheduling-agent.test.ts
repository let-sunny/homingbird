import { describe, expect, it } from 'vitest'
import { schedulingAgentModel } from '../../src/models/scheduling-agent.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, credential, debate } from '../support/fixtures.ts'

const START = Date.UTC(2026, 10, 19, 12)

type Answer = 'waiting' | 'choosing' | 'by_agent' | 'by_person'

const room = (answer: Answer = 'waiting', fields: Parameters<typeof debate>[0] = {}) =>
  debate({
    type: 'scheduling',
    schedule: {
      minutes: 60,
      window: { startsAt: START, endsAt: START + 4 * 3_600_000 },
      attendees: [
        { memberId: ANA, required: true, answer },
        { memberId: BEN, required: true, answer: 'waiting' },
      ],
    },
    ...fields,
  })

const AGENTS = [credential('cred_laptop000000', { name: 'Laptop' }), credential('cred_desk00000000')]

describe('schedulingAgentModel', () => {
  it('offers the person’s agents to answer a room none of them joined by itself', () => {
    expect(schedulingAgentModel({ debate: room(), viewerId: ANA, agents: AGENTS })).toEqual({
      title: strings.scheduling.agentTitle,
      hint: strings.scheduling.agentHint,
      agentLabel: strings.debates.chooseAgent,
      agents: [
        { value: 'cred_laptop000000', label: 'Laptop' },
        { value: 'cred_desk00000000', label: 'cred_desk00000000' },
      ],
      send: strings.scheduling.agentAnswer,
    })
  })

  it('is not there once an agent takes part or the person answered, with no agent, after the room, or for someone not asked', () => {
    const joined = room('waiting', {
      participants: [{ memberId: ANA, agentId: null, agentName: 'Laptop', joinedAt: 1 }],
    })
    expect(schedulingAgentModel({ debate: joined, viewerId: ANA, agents: AGENTS })).toBeNull()
    for (const answer of ['choosing', 'by_agent', 'by_person'] as const)
      expect(schedulingAgentModel({ debate: room(answer), viewerId: ANA, agents: AGENTS })).toBeNull()
    expect(schedulingAgentModel({ debate: room(), viewerId: ANA, agents: [] })).toBeNull()
    const closed = room('waiting', { status: 'closed' })
    expect(schedulingAgentModel({ debate: closed, viewerId: ANA, agents: AGENTS })).toBeNull()
    expect(schedulingAgentModel({ debate: debate(), viewerId: ANA, agents: AGENTS })).toBeNull()
    expect(
      schedulingAgentModel({ debate: room(), viewerId: 'mem_zed000000000' as never, agents: AGENTS }),
    ).toBeNull()
  })
})

import type { AsRead, MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  type AnswerersInput,
  channelAgentState,
  questionWaits,
  whoAnswers,
} from '../src/channel-answerers.ts'
import { formats, strings } from '../src/strings.ts'
import { ANA, BEN, CY, channel, entry, note } from './support/fixtures.ts'

const AGENT = 'mem_agent0000000' as MemberId
const awake = { humanOnline: false, agentOnline: true }

const input = (fields: Partial<AsRead.Channel> = {}, rest: Partial<AnswerersInput> = {}): AnswerersInput => ({
  channel: channel('billing', fields),
  directory: [],
  viewerId: ANA,
  agentsOn: true,
  ...rest,
})

describe('whoAnswers', () => {
  it('names the channel’s agent, which a manager approves, while the feature is on', () => {
    const agent = { id: AGENT, name: 'Billing helper', presence: awake }
    expect(whoAnswers(input({ agent }))).toEqual({
      text: strings.channelAnswer.agentDrafts({ agent: 'Billing helper' }),
      warning: false,
    })
    expect(whoAnswers(input({ agent: { id: AGENT, name: 'Billing helper' } })).warning).toBe(false)
    expect(whoAnswers(input({ agent, helperCount: 3 }, { agentsOn: false })).text).toBe(
      strings.channelAnswer.peopleAnswer({ count: 3 }),
    )
  })

  it('warns that the agent cannot answer now, and until when when that is known', () => {
    const unavailable = (until: number | null) =>
      whoAnswers(
        input({
          agent: { id: AGENT, name: 'Billing helper', presence: { ...awake, agentUnavailable: { until } } },
        }),
      )
    expect(unavailable(null)).toEqual({
      text: strings.channelAnswer.agentCannotAnswer({ agent: 'Billing helper' }),
      warning: true,
    })
    expect(unavailable(0).text).toBe(
      strings.channelAnswer.agentCannotAnswerUntil({
        agent: 'Billing helper',
        time: formats.time.format(new Date(0)),
      }),
    )
  })

  it('warns only when every other person who answers is known and away', () => {
    const away = { humanOnline: false, agentOnline: false }
    const ben = entry(BEN, 'Ben', { presence: away, channels: ['billing'] })
    const cy = entry(CY, 'Cy', { presence: awake, channels: ['billing'] })
    expect(whoAnswers(input({ helperCount: 1 }, { directory: [ben] })).warning).toBe(true)
    expect(whoAnswers(input({ helperCount: 2 }, { directory: [ben] })).warning).toBe(false)
    expect(whoAnswers(input({ helperCount: 2 }, { directory: [ben, cy] })).warning).toBe(false)
    expect(
      whoAnswers(input({ helperCount: 2, answering: true }, { directory: [ben, entry(ANA, 'Ana')] })).warning,
    ).toBe(true)
    expect(whoAnswers(input({ helperCount: 1, answering: true })).warning).toBe(false)
  })
})

describe('questionWaits', () => {
  it('says who answers, then that an answer is being drafted, by the agent when it is the one', () => {
    const agent = { id: AGENT, name: 'Billing helper', presence: awake }
    const receipt = (memberId: MemberId, draftingAt: number | null) => ({
      memberId,
      state: 'delivered' as const,
      deliveredAt: 1,
      readAt: null,
      draftingAt,
      repliedAt: null,
    })
    const asked = (receipts: AsRead.Receipt[]) => note('note_q', { receipts })
    expect(questionWaits(input({ agent }), asked([receipt(AGENT, null)])).text).toBe(
      strings.channelAnswer.agentDrafts({ agent: 'Billing helper' }),
    )
    expect(questionWaits(input({ agent }), asked([receipt(AGENT, 5)]))).toEqual({
      text: strings.channelAnswer.agentDrafting({ agent: 'Billing helper' }),
      warning: false,
    })
    expect(questionWaits(input(), asked([receipt(BEN, 5)])).text).toBe(strings.channelAnswer.drafting)
  })
})

describe('channelAgentState', () => {
  it('shows a channel’s agent as a person’s agent: awake, not connected, or unable to answer', () => {
    expect(channelAgentState({ id: AGENT, name: 'Helper' })).toBeNull()
    expect(channelAgentState({ id: AGENT, name: 'Helper', presence: awake })).toEqual({
      state: 'on',
      until: null,
      label: strings.channelAgentState.awake({ agent: 'Helper' }),
    })
    expect(
      channelAgentState({ id: AGENT, name: 'Helper', presence: { humanOnline: false, agentOnline: false } }),
    ).toEqual({
      state: 'off',
      until: null,
      label: strings.channelAgentState.notConnected({ agent: 'Helper' }),
    })
    expect(
      channelAgentState({
        id: AGENT,
        name: 'Helper',
        presence: { ...awake, agentUnavailable: { until: 0 } },
      }),
    ).toEqual({
      state: 'unavailable',
      until: 0,
      label: strings.channelAgentState.unavailableUntil({
        agent: 'Helper',
        time: formats.time.format(new Date(0)),
      }),
    })
    expect(
      channelAgentState({
        id: AGENT,
        name: 'Helper',
        presence: { ...awake, agentUnavailable: { until: null } },
      })?.label,
    ).toBe(strings.channelAgentState.unavailable({ agent: 'Helper' }))
  })
})

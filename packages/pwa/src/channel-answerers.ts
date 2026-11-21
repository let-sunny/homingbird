import type { AsRead, MemberId } from '@homingbird/protocol'
import { unavailableOf } from './presence.ts'
import { formats, strings } from './strings.ts'

/**
 * Who answers a question asked in a channel, said before it is sent: the channel's agent, which a
 * manager approves, or how many people answer there. It warns when nobody can answer now: the agent
 * is not connected or cannot answer, or everyone who answers is away.
 */
export const whoAnswers = (input: AnswerersInput): AnswerersLine => {
  const { channel } = input
  const agent = input.agentsOn ? (channel.agent ?? null) : null
  if (agent !== null) {
    const state = channelAgentState(agent)
    if (state?.state === 'off')
      return { text: strings.channelAnswer.agentNotConnected({ agent: agent.name }), warning: true }
    if (state?.state === 'unavailable')
      return {
        text:
          state.until === null
            ? strings.channelAnswer.agentCannotAnswer({ agent: agent.name })
            : strings.channelAnswer.agentCannotAnswerUntil({ agent: agent.name, time: timeOf(state.until) }),
        warning: true,
      }
    return { text: strings.channelAnswer.agentDrafts({ agent: agent.name }), warning: false }
  }
  if (channel.helperCount === 0) return { text: strings.channelAnswer.nobodyAnswers, warning: true }
  const answerers = input.directory.filter(
    (entry) => entry.member.id !== input.viewerId && entry.channels.includes(channel.slug),
  )
  const everyoneAway =
    answerers.length > 0 &&
    answerers.length >= channel.helperCount - (channel.answering ? 1 : 0) &&
    answerers.every((entry) => !entry.presence.humanOnline && !entry.presence.agentOnline)
  return everyoneAway
    ? { text: strings.channelAnswer.everyoneAway, warning: true }
    : { text: strings.channelAnswer.peopleAnswer({ count: channel.helperCount }), warning: false }
}

/**
 * The line under the person's own question while it waits for an answer: who answers, then that an
 * answer is being drafted once an agent picked it up.
 */
export const questionWaits = (input: AnswerersInput, note: AsRead.Note): AnswerersLine => {
  const drafting = note.receipts.filter((receipt) => receipt.draftingAt !== null)
  if (drafting.length === 0) return whoAnswers(input)
  const agent = input.agentsOn ? (input.channel.agent ?? null) : null
  return {
    text:
      agent !== null && drafting.some((receipt) => receipt.memberId === agent.id)
        ? strings.channelAnswer.agentDrafting({ agent: agent.name })
        : strings.channelAnswer.drafting,
    warning: false,
  }
}

/** A channel's agent as a person's agent is shown: awake, not connected, or unable to answer until a time. */
export const channelAgentState = (agent: ChannelAgentShown): ChannelAgentState | null => {
  if (agent.presence === undefined) return null
  const unavailable = unavailableOf(agent.presence)
  if (unavailable !== null)
    return {
      state: 'unavailable',
      until: unavailable.until,
      label:
        unavailable.until === null
          ? strings.channelAgentState.unavailable({ agent: agent.name })
          : strings.channelAgentState.unavailableUntil({
              agent: agent.name,
              time: timeOf(unavailable.until),
            }),
    }
  return agent.presence.agentOnline
    ? { state: 'on', until: null, label: strings.channelAgentState.awake({ agent: agent.name }) }
    : { state: 'off', until: null, label: strings.channelAgentState.notConnected({ agent: agent.name }) }
}

export interface AnswerersInput {
  readonly channel: AsRead.Channel
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly viewerId: MemberId
  /** Whether the organization has channel agents on; off, a channel's agent does not answer. */
  readonly agentsOn: boolean
}

export interface AnswerersLine {
  readonly text: string
  /** Nobody can answer now, so the question would wait. */
  readonly warning: boolean
}

export type ChannelAgentShown = NonNullable<AsRead.Channel['agent']>

export interface ChannelAgentState {
  readonly state: 'on' | 'off' | 'unavailable'
  readonly until: number | null
  readonly label: string
}

const timeOf = (timestamp: number): string => formats.time.format(new Date(timestamp))

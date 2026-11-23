import type { AsRead, MemberId } from '@homingbird/protocol'
import { strings } from '../strings.ts'

/**
 * The card that lets a person's agent answer a scheduling room it did not join by itself, because their
 * delegation is off or does not cover this room. It is there while the room collects times and the person
 * has neither answered nor been asked to choose.
 */
export const schedulingAgentModel = (input: SchedulingAgentInput): SchedulingAgentModel | null => {
  const { debate, viewerId } = input
  const attendee = debate.schedule?.attendees.find((one) => one.memberId === viewerId)
  if (debate.status !== 'open' || attendee === undefined || attendee.answer !== 'waiting') return null
  if (debate.participants.some((participant) => participant.memberId === viewerId)) return null
  if (input.agents.length === 0) return null
  return {
    title: strings.scheduling.agentTitle,
    hint: strings.scheduling.agentHint,
    agentLabel: strings.debates.chooseAgent,
    agents: input.agents.map((agent) => ({ value: agent.id, label: agent.name })),
    send: strings.scheduling.agentAnswer,
  }
}

export interface SchedulingAgentInput {
  readonly debate: AsRead.Debate
  readonly viewerId: MemberId
  readonly agents: ReadonlyArray<Pick<AsRead.Credential, 'id' | 'name'>>
}

export interface SchedulingAgentModel {
  readonly title: string
  readonly hint: string
  readonly agentLabel: string
  readonly agents: ReadonlyArray<{ readonly value: string; readonly label: string }>
  readonly send: string
}

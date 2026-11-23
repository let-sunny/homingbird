import type { AsRead, CredentialId, MemberId } from '@homingbird/protocol'
import { h } from '@homingbird/ui'
import { schedulingAgentModel } from '../models/scheduling-agent.ts'
import type { ViewContext } from './context.ts'
import { section } from './debate-result.ts'
import { field } from './parts.ts'

/** The card that opts the person's agent in to answer a scheduling flock it did not join by itself. */
export const schedulingAgentCard = (
  context: ViewContext,
  input: {
    readonly debate: AsRead.Debate
    readonly viewerId: MemberId
    readonly agents: ReadonlyArray<AsRead.Credential>
  },
): HTMLElement | null => {
  const model = schedulingAgentModel(input)
  if (model === null) return null
  const choice = h(
    'select',
    { name: 'agent' },
    model.agents.map((agent) => h('option', { value: agent.value }, agent.label)),
  )
  return section(
    model.title,
    'scheduling-agent',
    h('p', { class: 'hint' }, model.hint),
    h(
      'form',
      {
        class: 'scheduling-agent-form',
        on: {
          submit: (event) => {
            event.preventDefault()
            const chosen = model.agents.length > 1 ? choice.value : model.agents[0]!.value
            const agent = model.agents.find((one) => one.value === chosen)
            if (agent !== undefined)
              context.actions.optInAgent(input.debate.id, agent.value as CredentialId, '')
          },
        },
      },
      model.agents.length > 1 && field(model.agentLabel, choice),
      h('button', { type: 'submit', class: 'primary' }, model.send),
    ),
  )
}

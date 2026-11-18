import { type CredentialId, DRAFT_INSTRUCTION_MAX, type DraftRequest } from '@homingbird/protocol'
import { type Lifetime, h, region } from '@homingbird/ui'
import { askAgent, launch, loadAgents } from '../actions.ts'
import type { DraftDestination } from '../draft-requests.ts'
import { agentCredentials } from '../state.ts'
import { strings } from '../strings.ts'
import { button } from './parts.ts'

export const agentAsk = (
  life: Lifetime,
  destination: () => DraftDestination,
  asked: (request: DraftRequest) => void = () => {},
): HTMLDetailsElement => {
  const instruction = h('input', {
    name: 'instruction',
    maxlength: String(DRAFT_INSTRUCTION_MAX),
    placeholder: strings.agentInstructionPlaceholder,
    'aria-label': strings.agentInstructionLabel,
  })
  const picker = region(life, [agentCredentials], () => agentPicker(), { class: 'agent-picker' })
  const details = h('details', {
    class: 'ask-agent',
    on: { toggle: () => details.open && launch(loadAgents) },
  })
  const ask = (): void => {
    const chosen = picker.querySelector('select')?.value ?? ''
    launch(
      askAgent({
        destination: destination(),
        instruction: instruction.value,
        agentId: chosen === '' ? null : (chosen as CredentialId),
      }),
      (request) => {
        instruction.value = ''
        details.open = false
        asked(request)
      },
    )
  }
  instruction.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    ask()
  })
  details.append(
    h('summary', {}, strings.letAgentWrite),
    h('div', { class: 'ask-agent-row' }, instruction, picker, button(strings.askAgent, ask)),
  )
  return details
}

const agentPicker = (): HTMLSelectElement | false => {
  const agents = agentCredentials.get()
  return (
    agents.length > 1 &&
    h(
      'select',
      { name: 'agent', 'aria-label': strings.agentPickerLabel },
      h('option', { value: '' }, strings.anyAgent),
      agents.map((agent) => h('option', { value: agent.id }, agent.name)),
    )
  )
}

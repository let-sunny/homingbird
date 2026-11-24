import { type CredentialId, DRAFT_INSTRUCTION_MAX, type DraftRequest } from '@homingbird/protocol'
import { type Lifetime, h, region, slice } from '@homingbird/ui'
import type { DraftDestination } from '../draft-requests.ts'
import { featureOn } from '../features.ts'
import { agentChoices, chosenAgent } from '../models/agent-ask.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { type Unsaved, button, keepTyped } from './parts.ts'

/** "Let my agent write it": asks the person's agent for a draft, with an optional instruction. */
export const agentAsk = (
  context: ViewContext,
  life: Lifetime,
  destination: () => DraftDestination,
  asked: (request: DraftRequest) => void = () => {},
): HTMLDetailsElement =>
  agentAskPanel(context, life, (wanted, done) =>
    context.actions.askAgent(
      { destination: destination(), ...wanted },
      {
        done: (request) => {
          done()
          asked(request)
        },
      },
    ),
  )

/**
 * The same request where the room is not known yet: `ask` sends it, and calls `done` once it was
 * taken, which empties and closes the panel.
 */
export const agentAskPanel = (
  context: ViewContext,
  life: Lifetime,
  ask: (wanted: AskWanted, done: () => void) => void,
): HTMLDetailsElement => {
  const { state, actions } = context
  if (!featureOn('draftRequests', state.serverInfo.get()))
    return h('details', { hidden: true, class: 'ask-agent is-off' })
  const instruction = h('input', {
    name: 'instruction',
    maxlength: String(DRAFT_INSTRUCTION_MAX),
    placeholder: strings.agentInstructionPlaceholder,
    'aria-label': strings.agentInstructionLabel,
  })
  const unsaved: Unsaved = new Map()
  const offered = slice([state.agentCredentials], () => agentChoices(state.agentCredentials.get()))
  const picker = region(
    life,
    [offered],
    () => {
      const choices = offered.get()
      if (choices === null) return null
      const choice = h(
        'select',
        { name: 'agent', 'aria-label': strings.agentPickerLabel },
        choices.map((one) => h('option', { value: one.value }, one.label)),
      )
      keepTyped(unsaved, 'agent', choice, '')
      return choice
    },
    { class: 'agent-picker' },
  )
  const details = h('details', {
    class: 'ask-agent',
    on: { toggle: () => details.open && actions.loadAgents() },
  })
  const request = (): void =>
    ask(
      { instruction: instruction.value, agentId: chosenAgent(picker.querySelector('select')?.value ?? '') },
      () => {
        instruction.value = ''
        details.open = false
      },
    )
  instruction.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    request()
  })
  details.append(
    h('summary', {}, strings.letAgentWrite),
    h('div', { class: 'ask-agent-row' }, instruction, picker, button(strings.askAgent, request)),
  )
  return details
}

export interface AskWanted {
  readonly instruction: string
  readonly agentId: CredentialId | null
}

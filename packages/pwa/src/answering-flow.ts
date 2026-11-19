import {
  ANSWERING_FLOW_MAX_CHARACTERS,
  ANSWERING_FLOW_MAX_STEPS,
  type FlowStep,
  answeringFlowSteps,
  answeringFlowText,
} from '@homingbird/protocol'

/** The steps of a saved flow, for the editor; nothing when there is no flow. */
export const stepsFrom = (saved: string | null): FlowStep[] => {
  if (saved === null || saved.trim() === '') return []
  const read = answeringFlowSteps(saved)
  return read._tag === 'Ok' ? read.value : []
}

/** What is saved for a list of steps: the two headed lists, or no flow at all when there are none. */
export const flowToSave = (steps: ReadonlyArray<FlowStep>): string | null => {
  const text = answeringFlowText(steps)
  return text === '' ? null : text
}

export interface FlowSize {
  readonly used: number
  readonly max: number
  readonly steps: number
  readonly maxSteps: number
  readonly over: boolean
}

/** How much of the server's limits the steps take, counted on the text that is saved. */
export const flowSize = (steps: ReadonlyArray<FlowStep>): FlowSize => {
  const used = (flowToSave(steps) ?? '').length
  const count = steps.filter((step) => step.text.trim() !== '').length
  return {
    used,
    max: ANSWERING_FLOW_MAX_CHARACTERS,
    steps: count,
    maxSteps: ANSWERING_FLOW_MAX_STEPS,
    over: used > ANSWERING_FLOW_MAX_CHARACTERS || count > ANSWERING_FLOW_MAX_STEPS,
  }
}

export const mayInsertExample = (steps: ReadonlyArray<FlowStep>): boolean => steps.length === 0

/** Moves a step within its own list; the order is the order the agents follow. */
export const moveStep = (steps: ReadonlyArray<FlowStep>, step: FlowStep, to: number): FlowStep[] => {
  const part = steps.filter((each) => each.part === step.part && each !== step)
  part.splice(Math.max(0, Math.min(part.length, to)), 0, step)
  return [...steps.filter((each) => each.part !== step.part), ...part].sort(
    (a, b) => Number(a.part === 'checks') - Number(b.part === 'checks'),
  )
}

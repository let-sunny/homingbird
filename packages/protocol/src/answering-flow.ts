import { Result } from '@homingbird/kernel'

export interface AnsweringFlow {
  readonly before: ReadonlyArray<string>
  readonly checks: ReadonlyArray<string>
}

export const answeringFlowFrom = (text: string): Result.Result<AnsweringFlow, string> =>
  Result.map((rows: ReadonlyArray<FlowStep>) => ({
    before: rows.filter((row) => row.part === 'before' && row.enabled).map((row) => row.text),
    checks: rows.filter((row) => row.part === 'checks' && row.enabled).map((row) => row.text),
  }))(answeringFlowSteps(text))

/** One step of the flow as the editor shows it: turned off steps are kept, marked, and never reach an agent. */
export interface FlowStep {
  readonly part: 'before' | 'checks'
  readonly text: string
  readonly enabled: boolean
}

/** The stored text for a list of steps: two headed lists, a turned off step marked "[off]". */
export const answeringFlowText = (steps: ReadonlyArray<FlowStep>): string =>
  (['before', 'checks'] as const)
    .map((part) => {
      const items = steps.filter((step) => step.part === part && step.text.trim() !== '')
      return items.length === 0
        ? ''
        : [
            HEADINGS[part],
            ...items.map((step, index) => `${index + 1}. ${step.enabled ? '' : OFF_MARK}${step.text.trim()}`),
          ].join('\n')
    })
    .filter((part) => part !== '')
    .join('\n\n')

export const answeringFlowSteps = (text: string): Result.Result<FlowStep[], string> => {
  if (text.length > ANSWERING_FLOW_MAX_CHARACTERS)
    return Result.err(
      `The answering flow has ${text.length} characters; it may have at most ${ANSWERING_FLOW_MAX_CHARACTERS}. Shorten it.`,
    )
  const steps: { part: Part; text: string }[] = []
  let part: Part = 'before'
  let current: { part: Part; text: string } | null = null
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const heading = /^#{1,6}\s*(.*)$/.exec(trimmed)
    if (heading !== null) {
      const named = partNamed(heading[1]!)
      if (named === null) return Result.err(UNKNOWN_HEADING)
      part = named
      current = null
      continue
    }
    const item = /^(?:\d+[.)]|[-*+])\s+(.*)$/.exec(trimmed)
    if (item !== null) {
      current = { part, text: item[1]!.trim() }
      steps.push(current)
      continue
    }
    if (current === null) return Result.err(NOT_A_LIST)
    current.text = `${current.text} ${trimmed}`
  }
  if (steps.length > ANSWERING_FLOW_MAX_STEPS)
    return Result.err(
      `The answering flow has ${steps.length} steps; it may have at most ${ANSWERING_FLOW_MAX_STEPS}. Merge or remove some.`,
    )
  return Result.ok(
    steps.map((step) =>
      step.text.startsWith(OFF_MARK)
        ? { part: step.part, text: step.text.slice(OFF_MARK.length).trim(), enabled: false }
        : { ...step, enabled: true },
    ),
  )
}

export const ANSWERING_FLOW_MAX_CHARACTERS = 4000
export const ANSWERING_FLOW_MAX_STEPS = 20

type Part = keyof AnsweringFlow

const OFF_MARK = '[off] '

const HEADINGS: Readonly<Record<Part, string>> = {
  before: '## Before drafting',
  checks: '## Check the draft',
}

const partNamed = (heading: string): Part | null => {
  const name = heading.trim().toLowerCase()
  if (name === 'before drafting') return 'before'
  if (name === 'check the draft') return 'checks'
  return null
}

const UNKNOWN_HEADING =
  'The answering flow knows two headings, "## Before drafting" and "## Check the draft". Remove or rename the others.'

const NOT_A_LIST =
  'Write each step as an item of a numbered or bulleted list, such as "1. Look the question up in the wiki."'

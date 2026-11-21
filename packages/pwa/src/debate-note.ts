import { exportLabelsIn } from '@homingbird/protocol'

/**
 * The parts of a posted debate result a reader needs first: whether the agents agreed, the conclusion or
 * summary, and the next steps. The server writes the note in the export's English headings
 * (`debateResultText`); a body in any other shape gives null and is shown as written.
 */
export const debateNoteParts = (body: string): DebateNoteParts | null => {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const kindAt = lines.findIndex((line) => line === LABELS.conclusion || line === LABELS.noConclusion)
  if (kindAt === -1) return null
  const agreed = lines[kindAt] === LABELS.conclusion
  const contributionsAt = lines.lastIndexOf(LABELS.contributions)
  const stepsAt = lastIndexBefore(lines, LABELS.nextSteps, contributionsAt)
  const listAt = lastIndexBefore(lines, agreed ? LABELS.reasons : LABELS.disagreements, stepsAt)
  if (contributionsAt === -1 || stepsAt <= kindAt || listAt <= kindAt) return null
  const summary = lines
    .slice(kindAt + 1, listAt)
    .join('\n')
    .trim()
  if (summary === '') return null
  return {
    agreed,
    summary,
    nextSteps: lines
      .slice(stepsAt + 1, contributionsAt)
      .filter((line) => line.startsWith(ITEM))
      .map((line) => line.slice(ITEM.length).trim()),
  }
}

export interface DebateNoteParts {
  readonly agreed: boolean
  readonly summary: string
  readonly nextSteps: ReadonlyArray<string>
}

const LABELS = exportLabelsIn(null)

const ITEM = '- '

const lastIndexBefore = (lines: ReadonlyArray<string>, line: string, before: number): number =>
  before <= 0 ? -1 : lines.lastIndexOf(line, before - 1)

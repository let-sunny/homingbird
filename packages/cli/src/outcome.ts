export interface Outcome {
  readonly json: unknown
  readonly text: string
  /** The command's exit code once it has printed; 0 unless it reports a state a script must notice. */
  readonly exitCode: number
}

export const outcome = (json: unknown, text: string, exitCode = 0): Outcome => ({ json, text, exitCode })

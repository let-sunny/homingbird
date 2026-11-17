export interface Outcome {
  readonly json: unknown
  readonly text: string
}

export const outcome = (json: unknown, text: string): Outcome => ({ json, text })

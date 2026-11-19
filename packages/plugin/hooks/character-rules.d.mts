export declare const characterProblems: (input: unknown) => string[]
export declare const characterLink: (webClientUrl: string, spec: CharacterSpec) => string
export declare const BUILT_IN_CHARACTERS: ReadonlyArray<CharacterSpec>

export interface CharacterSpec {
  readonly version: 1
  readonly base: 'bubble-16'
  readonly id: string
  readonly name: string
  readonly palette: Readonly<Partial<Record<'B' | 'D' | 'O' | 'F' | 'K', string>>>
  readonly noFeet?: boolean
  readonly marks: ReadonlyArray<readonly [number, number, number, number, string]>
}

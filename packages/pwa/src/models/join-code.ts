import type { AsRead } from '@homingbird/protocol'
import { strings } from '../strings.ts'

/**
 * "Run on a server": the button that makes a join code, then the one line to paste on the server with
 * how long it still works, then, once it expired, a new code. `agent` names a channel's agent the code
 * is for; null for the person's own.
 */
export const joinCodeModel = (input: JoinCodeInput): JoinCodeModel => {
  const { state, agent } = input
  const title = strings.joinCode.title
  if (state.kind === 'made') {
    const remainingSeconds = Math.ceil((state.expiresAt - input.now) / 1000)
    if (remainingSeconds <= 0)
      return { kind: 'expired', title, text: strings.joinCode.expired, button: strings.joinCode.again }
    return {
      kind: 'code',
      title,
      command: joinCommand(state.code),
      explanation:
        agent === null ? strings.joinCode.explanation : strings.joinCode.explanationAgent({ agent }),
      countdown: strings.joinCode.expiresIn({ time: clockText(remainingSeconds) }),
      copy: state.copied === 'copied' ? strings.joinCode.copied : strings.joinCode.copy,
      copyProblem: state.copied === 'refused' ? strings.joinCode.copyFailed : null,
    }
  }
  return {
    kind: 'offer',
    title,
    intro: agent === null ? strings.joinCode.intro : strings.joinCode.introAgent({ agent }),
    button: state.kind === 'creating' ? strings.joinCode.creating : strings.joinCode.create,
    busy: state.kind === 'creating',
    problem: state.kind === 'failed' ? strings.joinCode.failed : null,
  }
}

/**
 * The line to paste on the server: it redeems the code and installs the background service. Its leading
 * space keeps it out of the history of a shell with `HISTCONTROL=ignorespace`.
 */
export const joinCommand = (code: AsRead.JoinCode): string =>
  ` homingbird setup --server ${code.serverUrl} --join ${code.code} --agent ${DEFAULT_AGENT}`

export type JoinCodeState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'creating' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'made'
      readonly code: AsRead.JoinCode
      /** When it expires on this browser's clock, from how long the server said it still works. */
      readonly expiresAt: number
      readonly copied: 'not yet' | 'copied' | 'refused'
    }

/** When a code expires on this browser's clock; a server that does not say how long it works gives its own time. */
export const localExpiry = (code: AsRead.JoinCode, now: number): number =>
  code.expiresInSeconds === undefined ? code.expiresAt : now + code.expiresInSeconds * 1000

export interface JoinCodeInput {
  readonly state: JoinCodeState
  readonly now: number
  readonly agent: string | null
}

export type JoinCodeModel =
  | {
      readonly kind: 'offer'
      readonly title: string
      readonly intro: string
      readonly button: string
      readonly busy: boolean
      readonly problem: string | null
    }
  | {
      readonly kind: 'code'
      readonly title: string
      readonly command: string
      readonly explanation: string
      readonly countdown: string
      readonly copy: string
      readonly copyProblem: string | null
    }
  | { readonly kind: 'expired'; readonly title: string; readonly text: string; readonly button: string }

const DEFAULT_AGENT = 'claude'

const clockText = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

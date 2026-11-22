import type { AsRead } from '@homingbird/protocol'
import { strings } from '../strings.ts'

/**
 * "Run on a server": the button that makes a join code, then the one line to paste on the server with
 * how long it still works, then which connection the server signed in as once the code was used and
 * whether it is awake, or, once it expired unused, a new code. `agent` names a channel's agent the code
 * is for; null for the person's own.
 */
export const joinCodeModel = (input: JoinCodeInput): JoinCodeModel => {
  const { state, agent } = input
  const title = strings.joinCode.title
  if (state.kind === 'connected')
    return {
      kind: 'connected',
      title,
      text:
        agent === null
          ? strings.joinCode.connected({ name: state.credential.name })
          : strings.joinCode.connectedAgent({ name: state.credential.name, agent }),
      awake: input.awake === true ? strings.joinCode.awakeNow : strings.joinCode.notAwakeYet,
      button: strings.joinCode.another,
    }
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
  | { readonly kind: 'connected'; readonly credential: { readonly id: string; readonly name: string } }

/** Whether the agent a code is for is awake: a channel's agent from its channel, else the viewer's own. */
export const isJoinedAgentAwake = (input: AwakeInput): boolean =>
  input.channel === null
    ? input.directory.find((entry) => entry.member.id === input.viewerId)?.presence.agentOnline === true
    : input.channels.find((each) => each.slug === input.channel)?.agent?.presence?.agentOnline === true

/** When a code expires on this browser's clock; a server that does not say how long it works gives its own time. */
export const localExpiry = (code: AsRead.JoinCode, now: number): number =>
  code.expiresInSeconds === undefined ? code.expiresAt : now + code.expiresInSeconds * 1000

export interface AwakeInput {
  readonly channel: string | null
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly viewerId: string | null
}

export interface JoinCodeInput {
  readonly state: JoinCodeState
  readonly now: number
  readonly agent: string | null
  /** Whether the agent the code is for is awake now, which matters once the code was used. */
  readonly awake?: boolean
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
  | {
      readonly kind: 'connected'
      readonly title: string
      readonly text: string
      readonly awake: string
      readonly button: string
    }

const DEFAULT_AGENT = 'claude'

const clockText = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

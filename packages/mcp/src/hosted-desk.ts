import {
  type DeskEnv,
  EXIT,
  type Outcome,
  type RunnerSettings,
  type Session,
  deskPausePath,
  runDesk,
} from '@homingbird/cli'
import { httpApi } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'

export type DeskPhase =
  | 'signed_out'
  | 'paused'
  | 'paused_on_computer'
  | 'waiting'
  | 'answering'
  | 'restarting'

/**
 * The desk runner hosted by this MCP server: the same runner as `homingbird run`, started with the
 * agent command from the person's MCP configuration, alive only while this server is. Nothing a model
 * can call changes or shows the command.
 */
export interface HostedDesk {
  readonly signedIn: (token: string) => T.Task<void>
  readonly signedOut: T.Task<void>
  readonly turn: (on: boolean) => T.Task<string>
  readonly describe: () => string
}

export interface HostedDeskOptions {
  readonly settings: RunnerSettings
  readonly serverUrl: string
  readonly scope: T.Scope
  readonly env: DeskEnv
  readonly log: (line: string) => void
}

export const makeHostedDesk = (options: HostedDeskOptions): HostedDesk => {
  let token: string | null = null
  let paused = false
  let phase: DeskPhase = 'signed_out'
  let running: T.Fiber<void, never> | null = null
  let missingCommand: string | null = null
  let memberId: string | null = null
  const env: DeskEnv = {
    ...options.env,
    output: {
      ...options.env.output,
      problem: (text) => {
        if (text.includes(NOT_FOUND)) missingCommand = text
        options.env.output.problem(text)
      },
    },
  }

  const stop: T.Task<void> = T.suspend(() => {
    const stopping = running
    running = null
    return stopping === null ? T.unit : stopping.interrupt
  })

  const start: T.Task<void> = T.gen(function* () {
    yield* stop
    if (token === null) return void (phase = 'signed_out')
    if (paused) return void (phase = 'paused')
    phase = 'waiting'
    running = yield* options.scope.fork(
      T.provide(env)(supervised(sessionFor(token))) as unknown as T.Task<void>,
    )
  })

  const sessionFor = (accepted: string): Session => ({
    credential: { serverUrl: options.serverUrl, token: accepted },
    api: httpApi({ serverUrl: options.serverUrl, fetch: options.env.fetch, token: () => accepted }),
  })

  const supervised = (session: Session): T.Task<void, never, DeskEnv> =>
    T.gen(function* () {
      for (;;) {
        const outcome = yield* T.exit(
          runDesk(session, options.settings, (step) => {
            phase = phaseAfter(step, phase)
            memberId = memberOf(step) ?? memberId
            if (stepOf(step) === 'drafted' || stepOf(step) === 'skipped') missingCommand = null
            options.log(logLine(step))
          }),
        )
        if (outcome._tag === 'Ok') return
        const failure = outcome.error._tag === 'Fail' ? outcome.error.error : null
        if (failure?.exitCode === EXIT.signedOut) {
          phase = 'signed_out'
          return options.log('Homingbird desk: the credential was refused; sign in again to restart it.')
        }
        phase = 'restarting'
        options.log(
          `Homingbird desk: ${failure?.message ?? 'stopped by an unexpected error.'} Trying again in a minute.`,
        )
        yield* T.sleep(RESTART_DELAY_MS)
      }
    })

  const isPausedOnComputer: T.Task<boolean> = T.suspend(() =>
    memberId === null
      ? T.succeed(phase === 'paused_on_computer')
      : options.env.files.exists(deskPausePath(options.env, options.serverUrl, memberId!)),
  )

  return {
    signedIn: (accepted) =>
      T.suspend(() => {
        token = accepted
        return start
      }),
    signedOut: T.suspend(() => {
      token = null
      phase = 'signed_out'
      return stop
    }),
    turn: (on) =>
      T.gen(function* () {
        paused = !on
        if (on && running === null) yield* start
        if (!on) {
          yield* stop
          if (token !== null) phase = 'paused'
        }
        if (on && token !== null && (yield* isPausedOnComputer)) return PAUSED_ON_COMPUTER_TEXT
        return turnedText(on, phase)
      }),
    describe: () =>
      missingCommand === null ? DESCRIPTIONS[phase] : `${DESCRIPTIONS[phase]} ${missingCommand}`,
  }
}

const NOT_FOUND = 'could not be found:'

export const DESCRIPTIONS: Readonly<Record<DeskPhase, string>> = {
  signed_out:
    'This app runs your Homingbird desk; it starts answering arriving notes once you are signed in.',
  paused:
    'This app’s Homingbird desk is turned off with the desk prompt: arriving notes wait until it is turned back on.',
  paused_on_computer:
    'Your Homingbird desks on this computer are paused with `homingbird desk pause`: arriving notes wait until you run `homingbird desk resume`.',
  waiting:
    'This app’s Homingbird desk is waiting: another desk on this computer is answering for you, and this one takes over when that one stops.',
  answering: 'This app’s Homingbird desk is answering arriving notes; every draft waits for your approval.',
  restarting: 'This app’s Homingbird desk stopped for a moment and is trying again.',
}

const phaseAfter = (step: Outcome, current: DeskPhase): DeskPhase => {
  const kind = stepOf(step)
  if (kind === 'waiting') return 'waiting'
  if (kind === 'online' || kind === 'resumed') return 'answering'
  if (kind === 'paused') return 'paused_on_computer'
  return current
}

const PAUSED_ON_COMPUTER_TEXT =
  'Tell me in one line: my Homingbird desk in this app is on, but my desks on this computer are paused with `homingbird desk pause`, so arriving notes wait until I run `homingbird desk resume`.'

const memberOf = (step: Outcome): string | null => {
  const member = (step.json as { member?: { id?: unknown } } | null)?.member
  return typeof member?.id === 'string' ? member.id : null
}

const stepOf = (step: Outcome): string =>
  typeof step.json === 'object' && step.json !== null && 'step' in step.json ? String(step.json.step) : ''

const logLine = (step: Outcome): string => {
  const json = step.json as Readonly<Record<string, unknown>>
  if (json.step === 'online') return 'Homingbird desk: answering arriving notes and draft requests.'
  if (json.step === 'skipped') return `Homingbird desk: gave ${String(json.noteId)} back without a draft.`
  return `Homingbird desk: ${step.text}`
}

const turnedText = (on: boolean, phase: DeskPhase): string =>
  on
    ? `Tell me in one line: ${phase === 'signed_out' ? DESCRIPTIONS.signed_out : 'my Homingbird desk is on again in this app.'}`
    : 'Tell me in one line: my Homingbird desk in this app is paused, and arriving notes wait until I turn it back on.'

const RESTART_DELAY_MS = 60_000

import { Task as T } from '@homingbird/kernel'
import { type Invocation, type Parsed, USAGE, parseArguments } from './arguments.ts'
import { channels } from './commands/channels.ts'
import { desk } from './commands/desk.ts'
import { draft, drafts, pickUp, skip } from './commands/drafting.ts'
import { login } from './commands/login.ts'
import { logout } from './commands/logout.ts'
import { open } from './commands/open.ts'
import { guidance, overview } from './commands/overview.ts'
import { presets } from './commands/presets.ts'
import { conversation, conversations, directory, inbox } from './commands/reading.ts'
import { requests } from './commands/requests.ts'
import { runAsService } from './commands/run-as-service.ts'
import { run } from './commands/run.ts'
import { installService, serviceStatus, stopService, uninstallService } from './commands/service.ts'
import { status } from './commands/status.ts'
import { stream } from './commands/stream.ts'
import type { CliEnv } from './environment.ts'
import type { CliFailure } from './failure.ts'
import { type Outcome, outcome } from './outcome.ts'

export const runCli = (argv: ReadonlyArray<string>): T.Task<number, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const parsed = parseArguments(argv, env.platform)
    if (parsed._tag === 'Err') return report(env, parsed.error, argv.includes('--json'))
    const server =
      parsed.value.server ?? (env.variables.HOMINGBIRD_SERVER?.trim().replace(/\/+$/, '') || null)
    const commandEnv = { ...env, server, ...(isService(parsed.value) && { output: timestamped(env) }) }
    const print = printer(commandEnv, parsed.value.json)
    const result = yield* T.result(T.provide(commandEnv)(execute(parsed.value, print)))
    if (result._tag === 'Err') return report(commandEnv, result.error, parsed.value.json)
    if (result.value !== null) print(result.value)
    return 0
  })

const execute = (
  parsed: Parsed,
  print: (step: Outcome) => void,
): T.Task<Outcome | null, CliFailure, CliEnv> => {
  const invocation: Invocation = parsed.invocation
  switch (invocation.command) {
    case 'help':
      return T.succeed(outcome({ usage: USAGE }, USAGE))
    case 'login':
      return login(invocation, print)
    case 'logout':
      return logout
    case 'status':
      return status
    case 'directory':
      return directory(invocation.query, invocation.channel)
    case 'channels':
      return channels(invocation.query)
    case 'requests':
      return requests
    case 'open':
      return open(invocation.conversationId)
    case 'run':
      return T.as(null)(invocation.isService ? runAsService(invocation, print) : run(invocation, print))
    case 'presets':
      return T.map((env: CliEnv) => presets(env.platform))(T.ask<CliEnv>())
    case 'service':
      return invocation.action === 'install'
        ? installService(invocation)
        : invocation.action === 'status'
          ? serviceStatus
          : invocation.action === 'stop'
            ? stopService
            : uninstallService
    case 'desk':
      return desk(invocation.action)
    case 'inbox':
      return inbox(invocation.fresh)
    case 'conversations':
      return conversations
    case 'conversation':
      return conversation(invocation.id)
    case 'draft':
      return draft(invocation.target, invocation.text, invocation.basis, invocation.model)
    case 'drafts':
      return drafts
    case 'overview':
      return overview
    case 'guidance':
      return guidance(invocation.conversationId)
    case 'pickup':
      return pickUp(invocation.noteId)
    case 'skip':
      return skip(invocation.noteId, invocation.reason)
    case 'stream':
      return T.as(null)(
        stream(invocation.after, (line) =>
          print(outcome(line, line.wrapped ?? `${line.event.body.type} (${line.event.seq})`)),
        ),
      )
  }
}

const printer =
  (env: CliEnv, json: boolean) =>
  (step: Outcome): void =>
    env.output.line(json ? JSON.stringify(step.json) : step.text)

const isService = (parsed: Parsed): boolean =>
  parsed.invocation.command === 'run' && parsed.invocation.isService === true

/** The background service's log is a file: each line says when it was written. */
const timestamped = (env: CliEnv): CliEnv['output'] => {
  const stamp = (text: string): string => {
    const at = new Date(env.clock.now()).toISOString()
    return text
      .split('\n')
      .map((line) => `${at} ${line}`)
      .join('\n')
  }
  return { line: (text) => env.output.line(stamp(text)), problem: (text) => env.output.problem(stamp(text)) }
}

const report = (env: CliEnv, failure: CliFailure, json: boolean): number => {
  env.output.problem(json ? JSON.stringify({ error: failure.message }) : failure.message)
  return failure.exitCode
}

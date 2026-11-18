import { Task as T } from '@homingbird/kernel'
import { type Invocation, type Parsed, USAGE, parseArguments } from './arguments.ts'
import { approve, discard, draft, drafts, pickUp } from './commands/drafting.ts'
import { login } from './commands/login.ts'
import { logout } from './commands/logout.ts'
import { open } from './commands/open.ts'
import { overview } from './commands/overview.ts'
import { conversation, conversations, directory, inbox } from './commands/reading.ts'
import { requests } from './commands/requests.ts'
import { run } from './commands/run.ts'
import { status } from './commands/status.ts'
import { stream } from './commands/stream.ts'
import { topics } from './commands/topics.ts'
import type { CliEnv } from './environment.ts'
import type { CliFailure } from './failure.ts'
import { type Outcome, outcome } from './outcome.ts'

export const runCli = (argv: ReadonlyArray<string>): T.Task<number, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const parsed = parseArguments(argv)
    if (parsed._tag === 'Err') return report(env, parsed.error, argv.includes('--json'))
    const print = printer(env, parsed.value.json)
    const result = yield* T.result(execute(parsed.value, print))
    if (result._tag === 'Err') return report(env, result.error, parsed.value.json)
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
      return directory(invocation.query, invocation.topic)
    case 'topics':
      return topics(invocation.query)
    case 'requests':
      return requests
    case 'open':
      return open(invocation.conversationId)
    case 'run':
      return T.as(null)(run(invocation.agent, invocation.timeoutSeconds, print))
    case 'inbox':
      return inbox(invocation.fresh)
    case 'conversations':
      return conversations
    case 'conversation':
      return conversation(invocation.id)
    case 'draft':
      return draft(invocation.target, invocation.text)
    case 'drafts':
      return drafts
    case 'overview':
      return overview
    case 'pickup':
      return pickUp(invocation.noteId)
    case 'approve':
      return approve(invocation.draftId, invocation.body)
    case 'discard':
      return discard(invocation.draftId)
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

const report = (env: CliEnv, failure: CliFailure, json: boolean): number => {
  env.output.problem(json ? JSON.stringify({ error: failure.message }) : failure.message)
  return failure.exitCode
}

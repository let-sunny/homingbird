import { Task as T, ok, systemClock } from '@homingbird/kernel'
import { logBackgroundEnded } from './background-pass.ts'
import { loadConfig } from './config.ts'
import { flushAttempts } from './domain/denied-attempts.ts'
import { startServer } from './http/node-server.ts'
import { invocationOf } from './invocation.ts'
import { type Log, makeLog, writeToStandardOutput } from './log/operational-log.ts'
import { logUnexpectedStop } from './log/unexpected-stop.ts'
import { buildRuntime } from './runtime.ts'
import { openReachableDatabase } from './sql/reachable.ts'
import { startDovecote } from './startup.ts'
import { SERVER_VERSION } from './version.ts'

const invocation = invocationOf(process.argv.slice(2))
if (invocation.kind === 'print') {
  ;(invocation.exitCode === 0 ? process.stdout : process.stderr).write(`${invocation.text}\n`)
  process.exit(invocation.exitCode)
}

const config = loadConfig(process.env, invocation.kind === 'serve' ? 'serve' : 'command')
if (config._tag === 'Err') {
  process.stderr.write(
    `Dovecote cannot start:\n${config.error.map((problem) => `  ${problem}`).join('\n')}\n`,
  )
  process.exit(1)
}

const cannotStart = (message: string): T.Task<never> =>
  T.sync(() => {
    process.stderr.write(invocation.kind === 'serve' ? `Dovecote cannot start: ${message}\n` : `${message}\n`)
    return process.exit(1)
  })

const stopWith = (sentence: string): T.Task<never> =>
  T.sync(() => {
    process.stderr.write(`${sentence}\n`)
    return process.exit(1)
  })

const shutdownSignal: T.Task<void> = T.async<void>((resume) => {
  const stop = (): void => resume(ok(undefined))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return () => {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
})

const program = T.gen(function* () {
  const opened = yield* T.result(openReachableDatabase(config.value.databaseUrl))
  if (opened._tag === 'Err') {
    if (opened.error._tag !== 'DatabaseUnreachable') return yield* cannotStart(opened.error.message)
    operationalLog().emit({ name: 'system.database_unreachable', attributes: { code: opened.error.code } })
    return yield* stopWith(opened.error.message)
  }
  const database = opened.value
  const { env, background } = buildRuntime({ config: config.value, database })
  const prepared = yield* T.provide(env)(
    T.result(startDovecote(invocation, config.value.port, (line) => process.stdout.write(`${line}\n`))),
  )
  if (prepared._tag === 'Err') {
    yield* database.close
    return yield* cannotStart(prepared.error.message)
  }
  if (prepared.value !== 'serve') {
    yield* database.close
    return process.exit(prepared.value.exitCode)
  }
  const backgroundWork = T.runFork(
    T.bracket(
      T.unit,
      () => background,
      (_, exit) => T.sync(() => logBackgroundEnded(env.log, exit)),
    ),
    env,
  )
  const server = yield* startServer(env, config.value.port)
  yield* shutdownSignal
  yield* server.close
  yield* T.promise(() => backgroundWork.interrupt())
  yield* T.provide(env)(flushAttempts('all'))
  yield* database.close
  process.exit(0)
})

const ended = await T.run(program, {})
if (ended._tag === 'Err') {
  process.stderr.write(`${logUnexpectedStop(operationalLog(), config.value.logs.operational, ended.error)}\n`)
  process.exit(1)
}

function operationalLog(): Log {
  return makeLog({
    level: config._tag === 'Ok' ? config.value.logs.operational : 'info',
    write: writeToStandardOutput,
    now: systemClock.now,
    version: SERVER_VERSION,
  })
}

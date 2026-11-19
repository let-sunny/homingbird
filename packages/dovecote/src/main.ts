import { Task as T, ok, systemClock } from '@homingbird/kernel'
import { logBackgroundEnded } from './background-pass.ts'
import { loadConfig } from './config.ts'
import { flushAttempts } from './domain/denied-attempts.ts'
import { startServer } from './http/node-server.ts'
import { makeLog } from './log/operational-log.ts'
import { logUnexpectedStop } from './log/unexpected-stop.ts'
import { buildRuntime } from './runtime.ts'
import { openDatabase } from './sql/open.ts'
import { startDovecote } from './startup.ts'
import { SERVER_VERSION } from './version.ts'

const config = loadConfig(process.env)
if (config._tag === 'Err') {
  process.stderr.write(
    `Dovecote cannot start:\n${config.error.map((problem) => `  ${problem}`).join('\n')}\n`,
  )
  process.exit(1)
}

const cannotStart = (message: string): T.Task<never> =>
  T.sync(() => {
    process.stderr.write(`Dovecote cannot start: ${message}\n`)
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
  const opened = yield* T.result(openDatabase(config.value.databaseUrl))
  if (opened._tag === 'Err') return yield* cannotStart(opened.error.message)
  const database = opened.value
  const { env, background } = buildRuntime({ config: config.value, database })
  const prepared = yield* T.provide(env)(
    T.result(
      startDovecote(process.argv.slice(2), config.value.port, (line) => process.stdout.write(`${line}\n`)),
    ),
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
  const log = makeLog({
    level: config.value.logs.operational,
    write: (line) => process.stdout.write(`${line}\n`),
    now: systemClock.now,
    version: SERVER_VERSION,
  })
  process.stderr.write(`${logUnexpectedStop(log, config.value.logs.operational, ended.error)}\n`)
  process.exit(1)
}

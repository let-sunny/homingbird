import { spawn } from 'node:child_process'
import { Task as T } from '@homingbird/kernel'
import { parseArguments } from './arguments.ts'
import { runCli } from './cli.ts'
import { nodeEnvironment } from './node-environment.ts'
import { respawnFor } from './service-respawn.ts'

const argv = process.argv.slice(2)
const parsed = parseArguments(argv, process.platform)
const invocation = parsed._tag === 'Ok' ? parsed.value.invocation : null
const respawn = respawnFor(process.platform, invocation, process.env)
const service = invocation?.command === 'run' && invocation.isService ? invocation : null

if (respawn !== null) {
  spawn(process.execPath, process.argv.slice(1), { ...respawn.options, env: respawn.environment }).unref()
} else {
  if (service?.workdir !== undefined) process.chdir(service.workdir)
  const stopping = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stopping.abort())
  const exit = await T.run(
    runCli(argv),
    nodeEnvironment(stopping.signal, {
      agentErrors: service === null ? 'inherit' : 'ignore',
      logFile: service?.logFile ?? null,
    }),
    stopping.signal,
  )
  process.exitCode = exit._tag === 'Ok' ? exit.value : stopping.signal.aborted ? 0 : 1
}

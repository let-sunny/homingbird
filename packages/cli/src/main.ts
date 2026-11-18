import { Task as T } from '@homingbird/kernel'
import { runCli } from './cli.ts'
import { nodeEnvironment } from './node-environment.ts'

const stopping = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stopping.abort())

const exit = await T.run(runCli(process.argv.slice(2)), nodeEnvironment(stopping.signal), stopping.signal)
process.exitCode = exit._tag === 'Ok' ? exit.value : stopping.signal.aborted ? 0 : 1

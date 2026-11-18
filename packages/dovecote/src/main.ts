import { Task as T } from '@homingbird/kernel'
import { loadConfig } from './config.ts'
import { startServer } from './http/node-server.ts'
import { prepareDatabase } from './prepare-database.ts'
import { buildRuntime } from './runtime.ts'
import { openDatabase } from './sql/open.ts'
import { SERVER_VERSION } from './version.ts'

const config = loadConfig(process.env)
if (config._tag === 'Err') {
  process.stderr.write(
    `Dovecote cannot start:\n${config.error.map((problem) => `  ${problem}`).join('\n')}\n`,
  )
  process.exit(1)
}

const database = await openDatabase(config.value.databaseUrl)
const { env, background } = buildRuntime({ config: config.value, database })
await T.runPromise(prepareDatabase, env)

const backgroundWork = T.runFork(background, env)
const server = await startServer(env, config.value.port)

env.log(`Dovecote ${SERVER_VERSION} is listening on port ${server.port}, serving ${config.value.publicUrl}`)
if (config.value.identity.devLogin)
  env.log(
    'WARNING: HB_DEV_LOGIN=1. Anyone who can reach this server can sign in as anyone. Never use in production.',
  )

const shutDown = async (): Promise<void> => {
  await server.close()
  await backgroundWork.interrupt()
  await database.close()
  process.exit(0)
}
process.once('SIGINT', shutDown)
process.once('SIGTERM', shutDown)

import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { dirname } from 'node:path'
import { systemClock } from '@homingbird/kernel'
import { type CliEnv, type Files, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from './environment.ts'

export const nodeEnvironment = (stopped: AbortSignal): CliEnv => ({
  clock: systemClock,
  fetch: globalThis.fetch,
  files: nodeFiles,
  output: {
    line: (text) => void process.stdout.write(`${text}\n`),
    problem: (text) => void process.stderr.write(`${text}\n`),
  },
  variables: process.env,
  homeDirectory: homedir(),
  hostName: hostname(),
  nonce: () => randomBytes(16).toString('hex'),
  stopped,
})

const nodeFiles: Files = {
  read: async (path) => {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  },
  writePrivate: async (path, content) => {
    await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    await chmod(dirname(path), PRIVATE_DIRECTORY_MODE)
    await writeFile(path, content, { mode: PRIVATE_FILE_MODE })
    await chmod(path, PRIVATE_FILE_MODE)
  },
  remove: (path) => rm(path, { force: true }),
}

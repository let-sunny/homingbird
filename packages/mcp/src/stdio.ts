#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes, randomInt } from 'node:crypto'
import { homedir, hostname } from 'node:os'
import { nodeFiles, nodeLauncher } from '@homingbird/cli'
import { Task as T, systemClock } from '@homingbird/kernel'
import { credentialFilePath } from './credential-file.ts'
import { runStdioProgram } from './stdio-program.ts'
import { ADAPTER_VERSION } from './version.ts'

const NONCE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

const toStandardError = (line: string): void => void process.stderr.write(`${line}\n`)

const exit = await T.run(
  runStdioProgram({
    arguments: process.argv.slice(2),
    environment: process.env,
    credentialPath: credentialFilePath(process.env, homedir()),
    hostName: hostname(),
    version: ADAPTER_VERSION,
    input: process.stdin,
    write: (line) => process.stdout.write(line),
    platform: process.platform,
    launch: (argv) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(argv[0]!, argv.slice(1), { stdio: 'ignore', detached: true, shell: false })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      }),
    deskEnv: {
      clock: systemClock,
      fetch: globalThis.fetch,
      files: nodeFiles,
      output: { line: toStandardError, problem: toStandardError },
      variables: process.env,
      homeDirectory: homedir(),
      nonce: () => randomBytes(16).toString('hex'),
      stopped: new AbortController().signal,
      launcher: nodeLauncher(process.platform),
    },
    log: toStandardError,
    nonce: () => Array.from({ length: 20 }, () => NONCE_ALPHABET[randomInt(NONCE_ALPHABET.length)]).join(''),
  }),
  { clock: systemClock },
)

if (exit._tag === 'Err') {
  const reason =
    exit.error._tag === 'Fail' ? exit.error.error.message : 'homingbird-mcp stopped unexpectedly.'
  process.stderr.write(`${reason}\n`)
  process.exit(exit.error._tag === 'Fail' ? 2 : 1)
}
process.exit(0)

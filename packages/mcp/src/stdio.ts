#!/usr/bin/env node
import { randomInt } from 'node:crypto'
import { homedir, hostname } from 'node:os'
import { Task as T, systemClock } from '@homingbird/kernel'
import { credentialFilePath } from './credential-file.ts'
import { runStdioProgram } from './stdio-program.ts'
import { ADAPTER_VERSION } from './version.ts'

const NONCE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

const exit = await T.run(
  runStdioProgram({
    arguments: process.argv.slice(2),
    environment: process.env,
    credentialPath: credentialFilePath(process.env, homedir()),
    hostName: hostname(),
    version: ADAPTER_VERSION,
    input: process.stdin,
    write: (line) => process.stdout.write(line),
    announce: (line) => process.stderr.write(`${line}\n`),
    nonce: () => Array.from({ length: 20 }, () => NONCE_ALPHABET[randomInt(NONCE_ALPHABET.length)]).join(''),
  }),
  { clock: systemClock },
)

if (exit._tag === 'Err') {
  const reason = exit.error._tag === 'Fail' ? exit.error.error.message : 'homingbird-mcp stopped unexpectedly.'
  process.stderr.write(`${reason}\n`)
  process.exit(exit.error._tag === 'Fail' ? 2 : 1)
}
process.exit(0)

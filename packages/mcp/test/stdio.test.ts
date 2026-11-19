import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { USAGE } from '../src/stdio-program.ts'
import { ADAPTER_VERSION } from '../src/version.ts'

const PROGRAM = fileURLToPath(new URL('../src/stdio.ts', import.meta.url))
const REPOSITORY = fileURLToPath(new URL('../../..', import.meta.url))

interface Ran {
  readonly code: number | null
  readonly output: string
  readonly problems: string
}

const runProgram = async (argv: ReadonlyArray<string>, input = ''): Promise<Ran> => {
  const configHome = await mkdtemp(join(tmpdir(), 'homingbird-mcp-stdio-'))
  const child = spawn(process.execPath, ['--import', 'tsx', PROGRAM, ...argv], {
    cwd: REPOSITORY,
    env: { ...windowsEssentials(), PATH: process.env.PATH, HOME: configHome, XDG_CONFIG_HOME: configHome },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  let problems = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (problems += chunk))
  child.stdin.end(input)
  const code = await new Promise<number | null>((resolve) => child.once('close', resolve))
  return { code, output, problems }
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
}

describe('homingbird-mcp', () => {
  it('prints its usage and exits 2 when no server is named', async () => {
    const ran = await runProgram([])
    expect(ran.code).toBe(2)
    expect(ran.output).toBe('')
    expect(ran.problems).toBe(`${USAGE}\n`)
  }, 20_000)

  it('serves JSON-RPC on standard output and exits 0 once its input ends', async () => {
    const ran = await runProgram(['--server', 'http://127.0.0.1:9'], `${JSON.stringify(INITIALIZE)}\n`)
    expect(ran.code).toBe(0)
    const [answer, ...rest] = ran.output.trim().split('\n')
    expect(rest).toEqual([])
    expect(JSON.parse(answer!)).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'homingbird', version: ADAPTER_VERSION } },
    })
    expect(ran.problems).not.toMatch(/hba_/)
  }, 20_000)
})

/** Windows cannot start Node without SystemRoot, and finds the home directory through USERPROFILE. */
const windowsEssentials = (): Record<string, string | undefined> =>
  process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, USERPROFILE: undefined } : {}

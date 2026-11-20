import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { launchesAsGiven, preparedLaunches } from '../src/agent-launch.ts'
import { agentCommand, defaultReader } from '../src/agent-presets.ts'
import { type WorldOptions, world } from './support.ts'

const prepared = async (
  settings: { agent: string; split: { reader: string } | null },
  options: Partial<WorldOptions> = {},
) => {
  const w = world({ signedIn: 'none', ...options })
  return { w, exit: await T.run(preparedLaunches(settings), w.env) }
}

const plain = (command: string) => ({ command, format: 'text', environment: {}, withoutStrictMcp: null })

describe('preparedLaunches', () => {
  it('launches a command of one’s own as given, without asking any program', async () => {
    const { w, exit } = await prepared({ agent: 'my-agent --fast', split: { reader: 'my-reader' } })
    expect(exit).toEqual({
      _tag: 'Ok',
      value: { agent: plain('my-agent --fast'), reader: plain('my-reader') },
    })
    expect(w.processRuns).toEqual([])
  })

  it('switches off, for the Codex reader, each MCP server Codex lists', async () => {
    const { w, exit } = await prepared(
      { agent: agentCommand('codex', 'linux'), split: { reader: defaultReader('codex', 'linux') } },
      { process: () => ({ exitCode: 0, output: '[{"name":"github"}]' }) },
    )
    expect(w.processRuns).toEqual([
      ['codex', '-c', 'features.plugins=false', '-c', 'features.apps=false', 'mcp', 'list', '--json'],
    ])
    expect(exit._tag === 'Ok' && exit.value.reader?.command).toBe(
      `${defaultReader('codex', 'linux').slice(0, -2)} -c 'mcp_servers={"github"={enabled=false}}' -`,
    )
    expect(exit._tag === 'Ok' && exit.value.agent.command).toBe(agentCommand('codex', 'linux'))
  })

  it('quotes the added words for cmd.exe on Windows', async () => {
    const { exit } = await prepared(
      { agent: 'my-agent', split: { reader: defaultReader('codex', 'win32') } },
      { platform: 'win32', process: () => ({ exitCode: 0, output: '[{"name":"github"}]' }) },
    )
    expect(exit._tag === 'Ok' && exit.value.reader?.command).toContain(
      '-c "mcp_servers={\\"github\\"={enabled=false}}" -',
    )
  })

  it('refuses to start a preset command its probe could not prepare, saying how to run it anyway', async () => {
    const { exit } = await prepared(
      { agent: 'my-agent', split: { reader: defaultReader('codex', 'linux') } },
      { process: () => ({ exitCode: 1, output: 'error' }) },
    )
    expect(exit).toMatchObject({
      _tag: 'Err',
      error: {
        _tag: 'Fail',
        error: {
          message:
            'The reader command was not started: codex mcp list exited with code 1, so it could not be prepared as the codex preset intends. Give --reader a command of your own to run it anyway.',
        },
      },
    })
  })

  it('takes a probe that could not be started for one that printed nothing', async () => {
    const { exit } = await prepared(
      { agent: 'my-agent', split: { reader: defaultReader('codex', 'linux') } },
      {
        process: () => {
          throw new Error('spawn codex ENOENT')
        },
      },
    )
    expect(exit).toMatchObject({ error: { error: { message: expect.stringContaining('code unknown') } } })
  })
})

describe('preparedLaunches for Antigravity', () => {
  const antigravity = {
    agent: agentCommand('antigravity', 'linux'),
    split: { reader: defaultReader('antigravity', 'linux') },
  }
  const answering = (help: string) => (_program: string, args: ReadonlyArray<string>) =>
    args[0] === '--help' ? { exitCode: 0, output: help } : { exitCode: 0, output: '{"usage":{}}' }

  it('asks once whether agy is signed in, without updating itself, before launching its stream', async () => {
    const runs: Array<[ReadonlyArray<string>, unknown]> = []
    const { exit } = await prepared(antigravity, {
      process: (program, args) => {
        runs.push([[program, ...args], null])
        return answering('  --settings <json>\n')(program, args)
      },
    })
    expect(runs.map(([argv]) => argv)).toEqual([
      ['agy', '-p', '/usage', '--output-format', 'json', '--print-timeout', '15s'],
      ['agy', '--help'],
    ])
    expect(exit).toMatchObject({
      _tag: 'Ok',
      value: {
        agent: { format: 'antigravity-stream', environment: { AGY_CLI_DISABLE_AUTO_UPDATE: 'true' } },
        reader: { command: antigravity.split.reader, format: 'antigravity-stream' },
      },
    })
  })

  it('starts nothing when agy is not signed in or does not answer in time', async () => {
    const { w, exit } = await prepared(antigravity, { process: () => ({ exitCode: null, output: '' }) })
    expect(exit).toMatchObject({
      error: { error: { message: expect.stringMatching(/^Antigravity did not answer within 20 seconds/) } },
    })
    expect(w.processRuns).toHaveLength(1)
  })

  it('refuses the reader of an agy that offers no --settings', async () => {
    const { exit } = await prepared(antigravity, { process: answering('Usage: agy [options]\n') })
    expect(exit).toMatchObject({
      error: { error: { message: expect.stringContaining('does not list --settings') } },
    })
  })
})

describe('launchesAsGiven', () => {
  it('launches the agent and the reader exactly as given', () => {
    expect(launchesAsGiven({ agent: 'claude -p', split: null })).toEqual({
      agent: plain('claude -p'),
      reader: null,
    })
  })
})

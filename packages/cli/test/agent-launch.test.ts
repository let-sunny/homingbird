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

describe('preparedLaunches', () => {
  it('launches a command of one’s own as given, without asking any program', async () => {
    const { w, exit } = await prepared({ agent: 'my-agent --fast', split: { reader: 'my-reader' } })
    expect(exit).toEqual({
      _tag: 'Ok',
      value: { agent: { command: 'my-agent --fast' }, reader: { command: 'my-reader' } },
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

describe('launchesAsGiven', () => {
  it('launches the agent and the reader exactly as given', () => {
    expect(launchesAsGiven({ agent: 'claude -p', split: null })).toEqual({
      agent: { command: 'claude -p' },
      reader: null,
    })
  })
})

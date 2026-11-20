import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import {
  ATTACH_NEEDS_PRESET,
  ATTACH_WITH_SPLIT,
  isAttachingMcp,
  launchesAsGiven,
  preparedLaunches,
} from '../src/agent-launch.ts'
import { agentCommand, defaultReader, presetNamed } from '../src/agent-presets.ts'
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
      value: { agent: plain('my-agent --fast'), reader: plain('my-reader'), installed: [] },
    })
    expect(w.processRuns).toEqual([])
  })

  it('switches off, for the Codex reader, each MCP server Codex lists', async () => {
    const { w, exit } = await prepared(
      { agent: agentCommand('codex', 'linux'), split: { reader: defaultReader('codex', 'linux') } },
      { process: () => ({ exitCode: 0, output: '[{"name":"github"}]' }) },
    )
    expect(w.processRuns).toEqual([
      ['codex', '--version'],
      ['codex', ...presetNamed('codex')!.reader!.probe!.args],
    ])
    expect(exit._tag === 'Ok' && exit.value.reader?.command).toBe(
      `${defaultReader('codex', 'linux').slice(0, -2)} -c 'mcp_servers."github".enabled=false' -`,
    )
    expect(exit._tag === 'Ok' && exit.value.agent.command).toBe(agentCommand('codex', 'linux'))
  })

  it('quotes the added words for cmd.exe on Windows', async () => {
    const { exit } = await prepared(
      { agent: 'my-agent', split: { reader: defaultReader('codex', 'win32') } },
      { platform: 'win32', process: () => ({ exitCode: 0, output: '[{"name":"github"}]' }) },
    )
    expect(exit._tag === 'Ok' && exit.value.reader?.command).toContain(
      '-c "mcp_servers.\\"github\\".enabled=false" -',
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
      ['agy', '--version'],
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
    expect(w.processRuns).toHaveLength(2)
  })

  it('refuses the reader of an agy that offers no --settings', async () => {
    const { exit } = await prepared(antigravity, { process: answering('Usage: agy [options]\n') })
    expect(exit).toMatchObject({
      error: { error: { message: expect.stringContaining('does not list --settings') } },
    })
  })
})

describe('preparedLaunches and versions', () => {
  const claude = {
    agent: agentCommand('claude', 'linux'),
    split: { reader: defaultReader('claude', 'linux') },
  }

  it('asks a preset’s program its version once, and says what is installed against what it needs', async () => {
    const { w, exit } = await prepared(claude, {
      process: () => ({ exitCode: 0, output: '2.1.329 (Claude Code)\n' }),
    })
    expect(w.processRuns).toEqual([['claude', '--version']])
    expect(exit).toMatchObject({
      _tag: 'Ok',
      value: {
        installed: [
          'Claude Code: 2.1.329, needs 2.1.259 or later; verified with Claude Code 2.1.327; options seen in Claude Code 2.1.329 --help',
        ],
      },
    })
  })

  it('refuses a program older than the preset works with, saying how to upgrade it', async () => {
    const { exit } = await prepared(claude, {
      process: () => ({ exitCode: 0, output: '2.0.76 (Claude Code)' }),
    })
    expect(exit).toMatchObject({
      error: {
        error: {
          message:
            'Claude Code 2.0.76 is older than 2.1.259, the oldest the claude preset works with. Upgrade it: claude update',
        },
      },
    })
  })

  it('starts with a version it cannot read', async () => {
    const { exit } = await prepared(claude, {
      process: () => ({ exitCode: 0, output: 'Claude Code (dev build)' }),
    })
    expect(exit).toMatchObject({
      _tag: 'Ok',
      value: { installed: [expect.stringContaining('version not readable')] },
    })
  })
})

describe('preparedLaunches with the MCP server attached', () => {
  const server = {
    command: 'npx',
    args: ['-y', '@homingbird/mcp@0.3.1', '--server', 'https://hb.example.com'],
    environment: { HOMINGBIRD_CREDENTIALS_FILE: '/home/june/.config/homingbird/agents/hb.json' },
  }
  const attached = async (agent: string, reader: string | null = null) => {
    const w = world({ signedIn: 'none' })
    return T.run(preparedLaunches({ agent, split: reader === null ? null : { reader } }, server), w.env)
  }

  it('gives Claude Code only this server for the run, inline', async () => {
    const exit = await attached(agentCommand('claude', 'linux'))
    if (exit._tag !== 'Ok') throw new Error('not prepared')
    const { agent, reader } = exit.value
    const config = agent.command.match(/--mcp-config '([^']*)' --strict-mcp-config$/)![1]!
    expect(JSON.parse(config)).toEqual({
      mcpServers: {
        homingbird: {
          type: 'stdio',
          command: 'npx',
          args: server.args,
          env: { HOMINGBIRD_CREDENTIALS_FILE: '/home/june/.config/homingbird/agents/hb.json' },
        },
      },
    })
    expect(agent.withoutStrictMcp?.command).toBe(agentCommand('claude', 'linux'))
    expect(reader).toBeNull()
  })

  it('gives Codex the server as one -c table, before the - that reads the prompt', async () => {
    const exit = await attached(agentCommand('codex', 'linux'))
    expect(exit._tag === 'Ok' && exit.value.agent.command).toBe(
      `${agentCommand('codex', 'linux').slice(0, -2)} -c 'mcp_servers.homingbird={command="npx",args=["-y","@homingbird/mcp@0.3.1","--server","https://hb.example.com"],env={HOMINGBIRD_CREDENTIALS_FILE="/home/june/.config/homingbird/agents/hb.json"}}' -`,
    )
    expect(exit._tag === 'Ok' && exit.value.agent.withoutStrictMcp).toBeNull()
  })

  it('refuses to attach in split mode, where the agent must never reach the note itself', async () => {
    expect(await attached(agentCommand('claude', 'linux'), defaultReader('claude', 'linux'))).toMatchObject({
      error: { error: { message: ATTACH_WITH_SPLIT } },
    })
  })

  it('refuses to attach to a command of one’s own or a preset with no known way', async () => {
    for (const agent of ['my-agent', agentCommand('gemini', 'linux')])
      expect(await attached(agent)).toMatchObject({ error: { error: { message: ATTACH_NEEDS_PRESET } } })
  })

  it('attaches only when asked, as no preset’s attaching has been run with the real agent yet', () => {
    expect(isAttachingMcp({ agent: agentCommand('claude', 'linux'), split: null }, 'linux')).toBe(false)
    expect(isAttachingMcp({ agent: 'my-agent', split: null, attachMcp: true }, 'linux')).toBe(true)
  })
})

describe('launchesAsGiven', () => {
  it('launches the agent and the reader exactly as given', () => {
    expect(launchesAsGiven({ agent: 'claude -p', split: null }, 'linux')).toEqual({
      agent: plain('claude -p'),
      reader: null,
      installed: [],
    })
  })

  it('still talks to a preset command in its format, with its variables, without probing it', () => {
    const { agent } = launchesAsGiven({ agent: agentCommand('antigravity', 'linux'), split: null }, 'linux')
    expect(agent).toMatchObject({
      format: 'antigravity-stream',
      environment: { AGY_CLI_DISABLE_AUTO_UPDATE: 'true' },
    })
  })
})

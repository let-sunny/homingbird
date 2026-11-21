import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  AGENT_PRESETS,
  agentCommand,
  defaultReader,
  isPresetCommand,
  isReaderWithSomeTools,
  presetAgent,
  presetCommandOf,
  presetNamed,
  presetReader,
  presetState,
  shellCommand,
  withWords,
} from '../src/agent-presets.ts'

const CODEX_READER = presetReader(presetNamed('codex')!, 'linux')!
const codexProbe = presetNamed('codex')!.reader!.probe!

describe('agent presets', () => {
  it('stand for documented commands by their bare names', () => {
    expect(agentCommand('claude', 'linux')).toBe(
      `claude -p --permission-prompts none --settings '{"disableAllHooks":true}'`,
    )
    expect(agentCommand(' codex ', 'linux')).toBe(
      'codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write -',
    )
    expect(agentCommand('antigravity', 'linux')).toBe(
      'agy --print= --input-format=stream-json --output-format=stream-json --sandbox',
    )
    expect(agentCommand('gemini', 'linux')).toBe("gemini -p '' --output-format text --approval-mode default")
    expect(agentCommand('gemini', 'win32')).toBe('gemini -p "" --output-format text --approval-mode default')
  })

  it('tell a preset’s agent and reader commands from a command of one’s own', () => {
    for (const preset of AGENT_PRESETS)
      expect(isPresetCommand(` ${agentCommand(preset.name, 'linux')} `, 'linux')).toBe(true)
    expect(isPresetCommand(defaultReader('claude', 'win32'), 'win32')).toBe(true)
    expect(presetCommandOf(CODEX_READER, 'darwin')).toMatchObject({
      role: 'reader',
      preset: { name: 'codex' },
    })
    expect(isPresetCommand('claude -p --verbose', 'linux')).toBe(false)
    expect(isPresetCommand('./my-agent.sh', 'darwin')).toBe(false)
  })

  it('give Claude Code a reader without built-in tools or MCP servers for split mode', () => {
    const reader = `claude -p --tools '' --strict-mcp-config --permission-prompts none --settings '{"disableAllHooks":true}'`
    expect(defaultReader('claude', 'linux')).toBe(reader)
    expect(defaultReader('claude', 'darwin')).toBe(reader)
  })

  it('run Claude Code without the person’s hooks, and deny what would wait for a permission prompt', () => {
    for (const command of [agentCommand('claude', 'linux'), defaultReader('claude', 'linux')])
      expect(command).toContain(`--permission-prompts none --settings '{"disableAllHooks":true}'`)
  })

  it('give the Claude Code reader a way past a managed MCP configuration with every MCP tool denied', () => {
    const fallback = presetNamed('claude')!.reader!.withoutStrictMcp!
    expect(shellCommand(fallback, 'linux')).toBe(
      `claude -p --tools '' --disallowedTools 'mcp__*' --permission-prompts none --settings '{"disableAllHooks":true}'`,
    )
    expect(presetNamed('claude')!.agent.withoutStrictMcp).toBeNull()
  })

  it('write the empty tool list as "" on Windows, where cmd.exe keeps single quotes', () => {
    expect(defaultReader('claude', 'win32')).toBe(
      'claude -p --tools "" --strict-mcp-config --permission-prompts none --settings "{\\"disableAllHooks\\":true}"',
    )
    expect(presetReader(presetNamed('gemini')!, 'win32')).toBeNull()
  })

  it('give Codex a reader with minimal tools, which is never taken for one without tools', () => {
    expect(presetNamed('codex')!.readerTools).toBe('minimal')
    expect(CODEX_READER).toContain('--sandbox read-only --disable shell_tool --disable unified_exec')
    expect(isReaderWithSomeTools(CODEX_READER)).toBe(true)
    expect(isReaderWithSomeTools(` ${defaultReader('codex', 'win32')} `)).toBe(true)
    expect(isReaderWithSomeTools(defaultReader('claude', 'linux'))).toBe(false)
    expect(isReaderWithSomeTools('my-reader')).toBe(false)
  })

  it('keep the Codex reader ephemeral, read-only and without plugins or apps', () => {
    expect(CODEX_READER).toContain('--ephemeral')
    expect(CODEX_READER).toContain('-c features.plugins=false -c features.apps=false -')
    expect(CODEX_READER.endsWith(' -')).toBe(true)
    expect(codexProbe.args).toEqual([
      '--ignore-user-config',
      '-c',
      'features.plugins=false',
      '-c',
      'features.apps=false',
      'mcp',
      'list',
      '--json',
    ])
  })

  it('switch off every MCP server Codex lists for the reader, and none when it lists none', () => {
    const listed = '[{"name":"github","transport":{"type":"stdio"}},{"name":"my \\"docs\\""}]'
    expect(codexProbe.wordsFrom({ exitCode: 0, output: `warning: old config\n${listed}\n` })).toEqual({
      _tag: 'Ok',
      value: ['-c', 'mcp_servers."github".enabled=false', '-c', 'mcp_servers."my \\"docs\\"".enabled=false'],
    })
    expect(codexProbe.wordsFrom({ exitCode: 0, output: '[]' })).toEqual({ _tag: 'Ok', value: [] })
  })

  it('refuse to prepare the Codex reader when its MCP servers cannot be listed', () => {
    expect(codexProbe.wordsFrom({ exitCode: 2, output: 'unknown command mcp' })).toEqual({
      _tag: 'Err',
      error: 'codex mcp list exited with code 2',
    })
    expect(codexProbe.wordsFrom({ exitCode: null, output: '' })).toMatchObject({
      error: 'codex mcp list exited with code unknown',
    })
    for (const output of ['', 'no servers', '[not json]', '[{"title":"x"}]', '] ['])
      expect(codexProbe.wordsFrom({ exitCode: 0, output })).toEqual({
        _tag: 'Err',
        error: 'codex mcp list --json printed no list of servers',
      })
  })

  it('give Antigravity a reader that denies every tool, and only where agy offers --settings', () => {
    const antigravity = presetNamed('antigravity')!
    const reader = defaultReader('antigravity', 'linux')
    expect(reader).toMatch(
      /^agy --print= --input-format=stream-json --output-format=stream-json --sandbox --settings '/,
    )
    const settings = JSON.parse(reader.slice(reader.indexOf("'") + 1, -1))
    expect(settings.permissions.deny).toEqual([
      'read_file(*)',
      'write_file(*)',
      'command(*)',
      'mcp(*)',
      'read_url(*)',
      'execute_url(*)',
    ])
    expect(antigravity.readerTools).toBe('minimal')
    expect(isReaderWithSomeTools(reader)).toBe(true)
    const probe = antigravity.reader!.probe!
    expect(probe.args).toEqual(['--help'])
    expect(probe.wordsFrom({ exitCode: 0, output: 'Options:\n  --settings <json>  Settings\n' })).toEqual({
      _tag: 'Ok',
      value: [],
    })
    expect(probe.wordsFrom({ exitCode: 0, output: '  --settings=<file>\n' })._tag).toBe('Ok')
    for (const printed of [
      { exitCode: 0, output: '  --settings-file <path>\n  see --settings in the docs\n' },
      { exitCode: 1, output: '  --settings <json>\n' },
    ])
      expect(probe.wordsFrom(printed)).toEqual({
        _tag: 'Err',
        error: 'agy --help does not list --settings, which the reader needs to deny every tool',
      })
  })

  it('keep Antigravity from updating itself, and ask it first whether it is signed in', () => {
    const antigravity = presetNamed('antigravity')!
    expect(antigravity.environment).toEqual({ AGY_CLI_DISABLE_AUTO_UPDATE: 'true' })
    expect(antigravity.agent.format).toBe('antigravity-stream')
    expect(antigravity.signInCheck).toMatchObject({
      args: ['-p', '/usage', '--output-format', 'json', '--print-timeout', '15s'],
      timeoutMs: 20_000,
    })
    for (const preset of AGENT_PRESETS.filter((each) => each.name !== 'antigravity')) {
      expect(preset.signInCheck).toBeNull()
      expect(preset.agent.format).toBe('text')
    }
  })

  it('fall back to the agent itself as the reader when no reader is known', () => {
    expect(defaultReader('gemini', 'linux')).toBe(agentCommand('gemini', 'linux'))
    expect(defaultReader('my-agent --fast', 'win32')).toBe('my-agent --fast')
  })

  it('leave every other command as it is', () => {
    fc.assert(
      fc.property(fc.string(), (command) => {
        fc.pre(presetNamed(command) === null)
        expect(agentCommand(command, 'linux')).toBe(command)
      }),
    )
    expect(agentCommand('claude -p --model opus', 'linux')).toBe('claude -p --model opus')
  })

  it('are verified only when run with the real agent, and otherwise say they come from source', () => {
    expect(AGENT_PRESETS.map((preset) => [preset.name, presetState(preset)])).toEqual([
      ['claude', 'verified with Claude Code 2.1.327; options seen in Claude Code 2.1.329 --help'],
      ['codex', 'not yet tested with the real CLI'],
      ['antigravity', 'not yet tested with the real CLI'],
      ['gemini', 'not yet tested with the real CLI'],
    ])
  })
})

describe('shellCommand', () => {
  it('quotes a word for sh with single quotes, a quote inside it included', () => {
    expect(shellCommand(['say', 'it\'s {"a":1}', '', 'plain-word.x'], 'linux')).toBe(
      `say 'it'\\''s {"a":1}' '' plain-word.x`,
    )
  })

  it('quotes a word for cmd.exe with double quotes, escaping each quote inside it', () => {
    expect(shellCommand(['say', '{"a":1}', ''], 'win32')).toBe('say "{\\"a\\":1}" ""')
  })

  it('doubles the backslashes before a quote and at the end, as Windows programs read them', () => {
    expect(shellCommand(['x', 'C:\\dir\\', 'a\\"b', '{"p":"C:\\\\a"}'], 'win32')).toBe(
      'x "C:\\dir\\\\" "a\\\\\\"b" "{\\"p\\":\\"C:\\\\a\\"}"',
    )
  })

  it('keeps the words, as sh reads them back', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ unit: 'grapheme-ascii' })), (words) => {
        expect(posixWords(shellCommand(['cmd', ...words], 'linux'))).toEqual(['cmd', ...words])
      }),
    )
  })
})

describe('withWords', () => {
  it('adds words before the final `-` that reads the prompt from standard input, or at the end', () => {
    expect(withWords(['codex', 'exec', '-'], ['-c', 'x'])).toEqual(['codex', 'exec', '-c', 'x', '-'])
    expect(withWords(['claude', '-p'], ['--x'])).toEqual(['claude', '-p', '--x'])
  })
})

/** Splits a command line the way sh does for the quoting shellCommand writes: plain words and single quotes. */
const posixWords = (line: string): string[] => {
  const words: string[] = []
  let current: string | null = null
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!
    if (character === ' ') {
      if (current !== null) words.push(current)
      current = null
    } else if (character === "'") {
      const end = line.indexOf("'", index + 1)
      current = (current ?? '') + line.slice(index + 1, end)
      index = end
    } else if (character === '\\') {
      current = (current ?? '') + line[index + 1]
      index++
    } else current = (current ?? '') + character
  }
  if (current !== null) words.push(current)
  return words
}

describe('the preset table in the command line’s README', () => {
  it('is the table the presets themselves give, with the commands `homingbird presets` prints', () => {
    const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8').replace(/\r\n/g, '\n')
    const start = readme.indexOf(TABLE_START)
    const end = readme.indexOf(TABLE_END)
    expect(start).toBeGreaterThan(-1)
    expect(readme.slice(start + TABLE_START.length, end).trim()).toBe(presetTable())
  })
})

describe('the agents table in the repository’s README', () => {
  it('says for each preset how far it is tested, as `homingbird presets` does', () => {
    const readme = readFileSync(join(import.meta.dirname, '..', '..', '..', 'README.md'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    for (const preset of AGENT_PRESETS) {
      const row = readme.split('\n').find((line) => line.includes(`| \`--agent ${preset.name}\` |`))
      expect(row, preset.name).toBeDefined()
      expect(row).toContain(
        preset.verifiedWith === null
          ? 'Not yet tested with the real CLI'
          : `Verified with ${preset.verifiedWith}`,
      )
    }
  })
})

const TABLE_START = '<!-- presets:start -->'
const TABLE_END = '<!-- presets:end -->'

/** The table as the README must hold it: regenerate it from this when a preset changes. */
const presetTable = (): string =>
  [
    '| Preset | Runs | Reader for `--split` | Status |',
    '| --- | --- | --- | --- |',
    ...AGENT_PRESETS.map((preset) => {
      const reader = presetReader(preset, 'linux')
      const readerCell =
        reader === null
          ? 'none: give `--reader` yourself'
          : `\`${reader}\`: ${preset.readerTools === 'none' ? 'no tools' : 'minimal tools, not none'}`
      const state = presetState(preset)
      return `| \`${preset.name}\` | \`${presetAgent(preset, 'linux')}\` | ${readerCell} | ${state[0]!.toUpperCase()}${state.slice(1)} |`
    }),
  ].join('\n')

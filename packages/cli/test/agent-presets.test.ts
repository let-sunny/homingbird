import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  AGENT_PRESETS,
  agentCommand,
  defaultReader,
  isPresetCommand,
  isReaderWithSomeTools,
  presetNamed,
  presetReader,
  presetState,
} from '../src/agent-presets.ts'

describe('agent presets', () => {
  it('stand for documented commands by their bare names', () => {
    expect(agentCommand('claude')).toBe('claude -p')
    expect(agentCommand(' codex ')).toBe(
      'codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write -',
    )
    expect(agentCommand('antigravity')).toBe('agy -p --mode default --output-format text')
    expect(agentCommand('gemini')).toBe('gemini -p "" --output-format text --approval-mode default')
  })

  it('tell a preset’s agent and reader commands from a command of one’s own', () => {
    for (const preset of AGENT_PRESETS) expect(isPresetCommand(` ${preset.agent} `, 'linux')).toBe(true)
    expect(isPresetCommand(defaultReader('claude', 'win32'), 'win32')).toBe(true)
    expect(isPresetCommand('claude -p --verbose', 'linux')).toBe(false)
    expect(isPresetCommand('./my-agent.sh', 'darwin')).toBe(false)
  })

  it('give Claude Code a reader without built-in tools or MCP servers for split mode', () => {
    expect(defaultReader('claude', 'linux')).toBe("claude -p --tools '' --strict-mcp-config")
    expect(defaultReader('claude', 'darwin')).toBe("claude -p --tools '' --strict-mcp-config")
  })

  it('write the empty tool list as "" on Windows, where cmd.exe keeps single quotes', () => {
    expect(defaultReader('claude', 'win32')).toBe('claude -p --tools "" --strict-mcp-config')
    expect(presetReader(presetNamed('gemini')!, 'win32')).toBeNull()
  })

  it('give Codex a reader with minimal tools, which is never taken for one without tools', () => {
    const codex = presetNamed('codex')!
    expect(codex.readerTools).toBe('minimal')
    expect(defaultReader('codex', 'linux')).toBe(codex.reader)
    expect(codex.reader).toContain('--sandbox read-only --disable shell_tool --disable unified_exec')
    expect(isReaderWithSomeTools(codex.reader!)).toBe(true)
    expect(isReaderWithSomeTools(` ${codex.reader} `)).toBe(true)
    expect(isReaderWithSomeTools(defaultReader('claude', 'linux'))).toBe(false)
    expect(isReaderWithSomeTools('my-reader')).toBe(false)
  })

  it('fall back to the agent itself as the reader when no reader is known', () => {
    expect(defaultReader('antigravity', 'linux')).toBe(agentCommand('antigravity'))
    expect(defaultReader('gemini', 'linux')).toBe(agentCommand('gemini'))
    expect(defaultReader('my-agent --fast', 'win32')).toBe('my-agent --fast')
  })

  it('leave every other command as it is', () => {
    fc.assert(
      fc.property(fc.string(), (command) => {
        fc.pre(presetNamed(command) === null)
        expect(agentCommand(command)).toBe(command)
      }),
    )
    expect(agentCommand('claude -p --model opus')).toBe('claude -p --model opus')
  })

  it('are verified only when run with the real agent, and otherwise say they come from source', () => {
    expect(AGENT_PRESETS.map((preset) => [preset.name, presetState(preset)])).toEqual([
      ['claude', 'verified with Claude Code 2.1.327'],
      ['codex', 'not yet tested with the real CLI'],
      ['antigravity', 'not yet tested with the real CLI'],
      ['gemini', 'not yet tested with the real CLI'],
    ])
  })
})

import { Result, Schema as S } from '@homingbird/kernel'
import type { ProcessRun } from './environment.ts'

/** A bare preset name stands for the preset's command; any other value is the command itself. */
export const agentCommand = (value: string, platform: string): string => {
  const preset = presetNamed(value)
  return preset === null ? value : shellCommand(preset.agent.words, platform)
}

/** The preset's reader for split mode, or else the agent itself, which the runner warns about. */
export const defaultReader = (value: string, platform: string): string => {
  const preset = presetNamed(value)
  return (preset === null ? null : presetReader(preset, platform)) ?? agentCommand(value, platform)
}

export const presetAgent = (preset: AgentPreset, platform: string): string =>
  shellCommand(preset.agent.words, platform)

export const presetReader = (preset: AgentPreset, platform: string): string | null =>
  preset.reader === null ? null : shellCommand(preset.reader.words, platform)

/** Which preset's agent or reader a command is, as `--agent <name>` gives it; null for one of one's own. */
export const presetCommandOf = (command: string, platform: string): PresetMatch | null => {
  for (const preset of AGENT_PRESETS)
    for (const role of ROLES) {
      const launch = preset[role]
      if (launch !== null && shellCommand(launch.words, platform) === command.trim())
        return { preset, role, launch }
    }
  return null
}

/** Whether a reader is a preset reader that still has some tools, which no toolless check accepts. */
export const isReaderWithSomeTools = (reader: string): boolean =>
  AGENT_PRESETS.some(
    (preset) =>
      preset.readerTools === 'minimal' &&
      SHELLS.some((platform) => presetReader(preset, platform) === reader.trim()),
  )

/** Whether a command is a preset's agent or reader command, as `--agent <name>` gives it. */
export const isPresetCommand = (command: string, platform: string): boolean =>
  presetCommandOf(command, platform) !== null

export const presetNamed = (value: string): AgentPreset | null =>
  AGENT_PRESETS.find((preset) => preset.name === value.trim()) ?? null

export const presetState = (preset: AgentPreset): string =>
  preset.verifiedWith === null ? 'not yet tested with the real CLI' : `verified with ${preset.verifiedWith}`

/**
 * One command line from its words, quoted for the shell that runs agent commands: sh, or cmd.exe on
 * Windows, which keeps single quotes and reads `\"` inside double quotes as a quote.
 */
export const shellCommand = (words: ReadonlyArray<string>, platform: string): string =>
  words.map((word) => shellWord(word, platform)).join(' ')

/** The words a probe adds go before a final `-`, which tells the program to read the prompt from standard input. */
export const withWords = (words: ReadonlyArray<string>, added: ReadonlyArray<string>): string[] =>
  words.at(-1) === '-' ? [...words.slice(0, -1), ...added, '-'] : [...words, ...added]

export interface AgentPreset {
  readonly name: string
  readonly program: string
  readonly agent: PresetCommand
  readonly reader: PresetCommand | null
  /** `none`: the reader runs without tools; `minimal`: with as few as the agent allows, never none. */
  readonly readerTools: 'none' | 'minimal' | null
  /** What the preset was run with; null while it is taken from the tool's source code only. */
  readonly verifiedWith: string | null
}

export interface PresetCommand {
  readonly words: ReadonlyArray<string>
  /** Asked of the program before the runner starts; what it prints adds words to the command. */
  readonly probe: LaunchProbe | null
}

export interface LaunchProbe {
  /** The program's arguments, run directly, without a shell. */
  readonly args: ReadonlyArray<string>
  /** The words to add from what the program printed, or why the command cannot be used as intended. */
  readonly wordsFrom: (printed: ProcessRun) => Result.Result<ReadonlyArray<string>, string>
}

export interface PresetMatch {
  readonly preset: AgentPreset
  readonly role: 'agent' | 'reader'
  readonly launch: PresetCommand
}

export const AGENT_PRESETS: ReadonlyArray<AgentPreset> = [
  {
    name: 'claude',
    program: 'Claude Code',
    agent: { words: ['claude', '-p'], probe: null },
    reader: { words: ['claude', '-p', '--tools', '', '--strict-mcp-config'], probe: null },
    readerTools: 'none',
    verifiedWith: 'Claude Code 2.1.327',
  },
  {
    name: 'codex',
    program: 'Codex CLI',
    agent: {
      words: ['codex', 'exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'workspace-write', '-'],
      probe: null,
    },
    reader: {
      words: [
        ...[
          'codex',
          'exec',
          '--skip-git-repo-check',
          '--ephemeral',
          '--ignore-user-config',
          '--ignore-rules',
        ],
        ...['--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'unified_exec'],
        ...['--disable', 'view_image', '-c', 'web_search="disabled"'],
        ...['-c', 'features.plugins=false', '-c', 'features.apps=false', '-'],
      ],
      probe: {
        args: ['-c', 'features.plugins=false', '-c', 'features.apps=false', 'mcp', 'list', '--json'],
        wordsFrom: (printed) => codexServersSwitchedOff(printed),
      },
    },
    readerTools: 'minimal',
    verifiedWith: null,
  },
  {
    name: 'antigravity',
    program: 'Antigravity CLI (agy)',
    agent: { words: ['agy', '-p', '--mode', 'default', '--output-format', 'text'], probe: null },
    reader: null,
    readerTools: null,
    verifiedWith: null,
  },
  {
    name: 'gemini',
    program: 'Gemini CLI, legacy: Code Assist Standard or Enterprise, or an API key',
    agent: {
      words: ['gemini', '-p', '', '--output-format', 'text', '--approval-mode', 'default'],
      probe: null,
    },
    reader: null,
    readerTools: null,
    verifiedWith: null,
  },
]

const ROLES = ['agent', 'reader'] as const

const SHELLS = ['linux', 'win32']

const PLAIN_WORD = /^[\w@+=:,./-]+$/

const shellWord = (word: string, platform: string): string => {
  if (PLAIN_WORD.test(word)) return word
  if (platform === 'win32') return `"${word.replace(/"/g, '\\"')}"`
  return `'${word.replace(/'/g, `'\\''`)}'`
}

/**
 * Codex loads every MCP server its configuration names, also in a read-only sandbox, so the reader
 * switches off each one `codex mcp list --json` names.
 */
const codexServersSwitchedOff = (printed: ProcessRun): Result.Result<ReadonlyArray<string>, string> => {
  if (printed.exitCode !== 0)
    return Result.err(`codex mcp list exited with code ${printed.exitCode ?? 'unknown'}`)
  const listed = CodexServers.read(jsonArrayIn(printed.output))
  if (listed._tag === 'Err') return Result.err('codex mcp list --json printed no list of servers')
  if (listed.value.length === 0) return Result.ok([])
  const off = listed.value.map((server) => `${JSON.stringify(server.name)}={enabled=false}`)
  return Result.ok(['-c', `mcp_servers={${off.join(',')}}`])
}

const CodexServers = S.array(S.struct({ name: S.string({ minLength: 1 }) }))

/** The JSON list in what a program printed, past any warning it wrote around it; null when there is none. */
const jsonArrayIn = (output: string): unknown => {
  const start = output.indexOf('[')
  const end = output.lastIndexOf(']')
  if (start === -1 || end < start) return null
  try {
    return JSON.parse(output.slice(start, end + 1))
  } catch {
    return null
  }
}

/** A bare preset name stands for the preset's command; any other value is the command itself. */
export const agentCommand = (value: string): string => presetNamed(value)?.agent ?? value

/** The preset's reader for split mode, or else the agent itself, which the runner warns about. */
export const defaultReader = (value: string, platform: string): string => {
  const preset = presetNamed(value)
  return (preset === null ? null : presetReader(preset, platform)) ?? agentCommand(value)
}

/** cmd.exe, which runs agent commands on Windows, keeps single quotes: an empty argument is `""` there. */
export const presetReader = (preset: AgentPreset, platform: string): string | null =>
  preset.reader === null || platform !== 'win32' ? preset.reader : preset.reader.replace(/''/g, '""')

/** Whether a reader is a preset reader that still has some tools, which no toolless check accepts. */
export const isReaderWithSomeTools = (reader: string): boolean =>
  AGENT_PRESETS.some(
    (preset) =>
      preset.readerTools === 'minimal' &&
      ['linux', 'win32'].some((platform) => presetReader(preset, platform) === reader.trim()),
  )

/** Whether a command is a preset's agent or reader command, as `--agent <name>` gives it. */
export const isPresetCommand = (command: string, platform: string): boolean =>
  AGENT_PRESETS.some(
    (preset) => preset.agent === command.trim() || presetReader(preset, platform) === command.trim(),
  )

export const presetNamed = (value: string): AgentPreset | null =>
  AGENT_PRESETS.find((preset) => preset.name === value.trim()) ?? null

export const presetState = (preset: AgentPreset): string =>
  preset.verifiedWith === null ? 'not yet tested with the real CLI' : `verified with ${preset.verifiedWith}`

export interface AgentPreset {
  readonly name: string
  readonly program: string
  readonly agent: string
  readonly reader: string | null
  /** `none`: the reader runs without tools; `minimal`: with as few as the agent allows, never none. */
  readonly readerTools: 'none' | 'minimal' | null
  /** What the preset was run with; null while it is taken from the tool's source code only. */
  readonly verifiedWith: string | null
}

export const AGENT_PRESETS: ReadonlyArray<AgentPreset> = [
  {
    name: 'claude',
    program: 'Claude Code',
    agent: 'claude -p',
    reader: "claude -p --tools '' --strict-mcp-config",
    readerTools: 'none',
    verifiedWith: 'Claude Code 2.1.327',
  },
  {
    name: 'codex',
    program: 'Codex CLI',
    agent: 'codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write -',
    reader: [
      'codex exec --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules',
      '--sandbox read-only --disable shell_tool --disable unified_exec --disable view_image',
      '-c web_search="disabled" -',
    ].join(' '),
    readerTools: 'minimal',
    verifiedWith: null,
  },
  {
    name: 'antigravity',
    program: 'Antigravity CLI (agy)',
    agent: 'agy -p --mode default --output-format text',
    reader: null,
    readerTools: null,
    verifiedWith: null,
  },
  {
    name: 'gemini',
    program: 'Gemini CLI, legacy: Code Assist Standard or Enterprise, or an API key',
    agent: 'gemini -p "" --output-format text --approval-mode default',
    reader: null,
    readerTools: null,
    verifiedWith: null,
  },
]

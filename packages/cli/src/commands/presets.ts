import { AGENT_PRESETS, type AgentPreset, presetAgent, presetReader, presetState } from '../agent-presets.ts'
import { type Outcome, outcome } from '../outcome.ts'

/** The agent presets `--agent` accepts by name, and how far each has been verified. */
export const presets = (platform: string): Outcome =>
  outcome(
    {
      presets: AGENT_PRESETS.map((preset) => ({
        name: preset.name,
        program: preset.program,
        agent: presetAgent(preset, platform),
        reader: presetReader(preset, platform),
        readerTools: preset.readerTools,
        verifiedWith: preset.verifiedWith,
        state: presetState(preset),
      })),
    },
    [
      'Agent presets for run and service install (--agent <name>):',
      ...AGENT_PRESETS.flatMap((preset) => [
        '',
        `  ${preset.name}  ${preset.program}; ${presetState(preset)}`,
        `    agent:   ${presetAgent(preset, platform)}`,
        `    reader:  ${readerLine(preset, platform)}`,
      ]),
      '',
      'Any other --agent value is run as the command it is.',
    ].join('\n'),
  )

const readerLine = (preset: AgentPreset, platform: string): string => {
  const reader = presetReader(preset, platform)
  if (reader === null) return 'none known; with --split, give --reader yourself'
  return preset.readerTools === 'minimal' ? `${reader}  (minimal tools, not none)` : `${reader}  (no tools)`
}

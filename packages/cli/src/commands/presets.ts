import { Task as T } from '@homingbird/kernel'
import { AGENT_PRESETS, type AgentPreset, presetAgent, presetReader, presetState } from '../agent-presets.ts'
import { presetVersion, versionLine } from '../agent-version.ts'
import type { CliEnv } from '../environment.ts'
import { type Outcome, outcome } from '../outcome.ts'

/** The agent presets `--agent` accepts by name, how far each has been verified, and which version is installed. */
export const presets: T.Task<Outcome, never, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  const { platform } = env
  const installed = yield* T.forEach(AGENT_PRESETS, presetVersion)
  return outcome(
    {
      presets: AGENT_PRESETS.map((preset, index) => ({
        name: preset.name,
        program: preset.program,
        agent: presetAgent(preset, platform),
        reader: presetReader(preset, platform),
        readerTools: preset.readerTools,
        verifiedWith: preset.verifiedWith,
        optionsSeenIn: preset.optionsSeenIn,
        minimumVersion: preset.minimumVersion,
        installed: installed[index]!,
        state: presetState(preset),
        accountRisk: preset.accountRisk,
      })),
    },
    [
      'Agent presets for run and service install (--agent <name>):',
      ...AGENT_PRESETS.flatMap((preset, index) => [
        '',
        `  ${preset.name}  ${preset.program}; ${presetState(preset)}`,
        `    here:    ${versionLine(preset, installed[index]!)}`,
        `    agent:   ${presetAgent(preset, platform)}`,
        `    reader:  ${readerLine(preset, platform)}`,
        ...(preset.accountRisk === null ? [] : [`    account: ${preset.accountRisk}`]),
      ]),
      '',
      'Any other --agent value is run as the command it is.',
    ].join('\n'),
  )
})

const readerLine = (preset: AgentPreset, platform: string): string => {
  const reader = presetReader(preset, platform)
  if (reader === null) return 'none known; with --split, give --reader yourself'
  return preset.readerTools === 'minimal' ? `${reader}  (minimal tools, not none)` : `${reader}  (no tools)`
}

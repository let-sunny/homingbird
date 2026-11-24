import {
  type AsRead,
  CHANNEL_INSTRUCTION_MAX,
  CHANNEL_SOURCES_MAX,
  type ChannelInstructionProblem,
  PrincipleSource,
  type TaughtFrom,
  channelInstructionProblem,
  isLikelyForbidden,
  suggestedChange,
} from '@homingbird/protocol'
import { channelLabel } from '../channels.ts'
import { featureOn } from '../features.ts'
import { suggestionText } from '../principles.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ListWait } from './start.ts'
import { type ChannelPrincipleRow, channelPrincipleRow } from './teaching.ts'

/**
 * The tabs of a channel agent's page: its answers, and Teach while the organization keeps teaching on.
 * Teach asked for while teaching is off shows the answers.
 */
export const channelAgentTabsModel = (
  slug: string,
  info: AsRead.ServerInfo | null,
  asked: ChannelAgentTab,
): ChannelAgentTabs => {
  const teaching = featureOn('teaching', info)
  const shown: ChannelAgentTab = asked === 'teach' && teaching ? 'teach' : 'answers'
  const tabs: ReadonlyArray<ChannelAgentTab> = teaching ? ['answers', 'teach'] : ['answers']
  return {
    label: strings.channelTeach.tabsLabel({ channel: channelLabel(slug) }),
    tabs: tabs.map((tab) => ({
      tab,
      href: hrefFor({ name: 'channel-agent', slug, draft: null, ...(tab === 'teach' && { teach: true }) }),
      label: strings.channelTeach.tabs[tab],
      current: tab === shown,
    })),
    shown,
  }
}

/** What the managers taught the agent: its instruction and sources, then its principles in their order. */
export const channelTeachingModel = (
  teaching: AsRead.ChannelTeaching | null,
  wait: ListWait | null,
  agent: string,
): ChannelTeachingModel => {
  if (teaching === null) return { kind: 'waiting', wait }
  const channel = channelLabel(teaching.channel)
  return {
    kind: 'taught',
    intro: strings.channelTeach.intro({ agent, channel }),
    instruction: {
      title: strings.channelTeach.instructionTitle,
      label: strings.channelTeach.instruction,
      hint: strings.channelTeach.instructionHint({ agent, max: CHANNEL_INSTRUCTION_MAX }),
      placeholder: strings.channelTeach.instructionPlaceholder,
      value: teaching.instruction,
      maxLength: CHANNEL_INSTRUCTION_MAX,
      sourcesLabel: strings.channelTeach.sources,
      sourcesHint: strings.channelTeach.sourcesHint({ max: CHANNEL_SOURCES_MAX }),
      sources: teaching.sources.join('\n'),
      save: strings.channelTeach.saveInstruction,
    },
    principlesTitle: strings.channelTeach.principlesTitle,
    add: strings.channelTeach.add({ agent }),
    limit: strings.teach.limit({ count: teaching.principles.length, limit: teaching.limit }),
    listLabel: strings.channelTeach.listLabel({ agent }),
    empty:
      teaching.principles.length === 0
        ? { title: strings.channelTeach.empty({ agent }), hint: strings.channelTeach.emptyHint }
        : null,
    principles: teaching.principles.map(channelPrincipleRow),
    footnotes: [strings.channelTeach.privacy({ agent, channel }), strings.channelTeach.audit],
  }
}

/** The warning under the instruction as it is typed: one that asks for a forbidden action is ignored. */
export const instructionWarning = (instruction: string): string | null =>
  isLikelyForbidden({ topic: '', rule: instruction }) ? strings.channelTeach.instructionForbidden : null

/** What saving the instruction sends, one source per non-empty line, or why it cannot be saved yet. */
export const instructionToSave = (
  instruction: string,
  sourcesText: string,
): { readonly problem: string } | { readonly save: InstructionSave } => {
  const sources = sourcesText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (sources.some((source) => PrincipleSource.decode(source)._tag === 'Err'))
    return { problem: strings.channelTeach.problems.source_invalid }
  const problem = channelInstructionProblem({ instruction, sources })
  if (problem !== null) return { problem: problemWording(problem) }
  return { save: { instruction: instruction.trim(), sources } }
}

/**
 * "Teach from this correction" on an answer a manager edited or discarded: the principle form prefilled
 * from what they changed, never saved until they save it. A discard prefills nothing.
 */
export const correctionPrefill = (
  agentBody: string,
  correction: { readonly kind: 'edit'; readonly body: string } | { readonly kind: 'discard' },
  slug: string,
): CorrectionPrefill => {
  const change = correction.kind === 'edit' ? suggestedChange(agentBody, correction.body) : null
  return {
    taughtFrom: correction.kind,
    rule: change === null ? '' : suggestionText(change),
    label:
      correction.kind === 'edit' ? strings.channelTeach.fromCorrection : strings.channelTeach.fromDiscard,
    hint: strings.channelTeach.correctionHint({ channel: channelLabel(slug) }),
  }
}

export type ChannelAgentTab = 'answers' | 'teach'

export interface ChannelAgentTabs {
  readonly label: string
  readonly tabs: ReadonlyArray<{
    readonly tab: ChannelAgentTab
    readonly href: string
    readonly label: string
    readonly current: boolean
  }>
  readonly shown: ChannelAgentTab
}

export type ChannelTeachingModel =
  | { readonly kind: 'waiting'; readonly wait: ListWait | null }
  | {
      readonly kind: 'taught'
      readonly intro: string
      readonly instruction: {
        readonly title: string
        readonly label: string
        readonly hint: string
        readonly placeholder: string
        readonly value: string
        readonly maxLength: number
        readonly sourcesLabel: string
        readonly sourcesHint: string
        readonly sources: string
        readonly save: string
      }
      readonly principlesTitle: string
      readonly add: string
      readonly limit: string
      readonly listLabel: string
      readonly empty: { readonly title: string; readonly hint: string } | null
      readonly principles: ReadonlyArray<ChannelPrincipleRow>
      readonly footnotes: ReadonlyArray<string>
    }

export interface InstructionSave {
  readonly instruction: string
  readonly sources: ReadonlyArray<string>
}

export interface CorrectionPrefill {
  readonly taughtFrom: TaughtFrom
  readonly rule: string
  readonly label: string
  readonly hint: string
}

const problemWording = (problem: ChannelInstructionProblem): string =>
  problem === 'instruction_too_long'
    ? strings.channelTeach.problems.instruction_too_long({ max: CHANNEL_INSTRUCTION_MAX })
    : problem === 'too_many_sources'
      ? strings.channelTeach.problems.too_many_sources({ max: CHANNEL_SOURCES_MAX })
      : strings.channelTeach.problems.sources_repeated

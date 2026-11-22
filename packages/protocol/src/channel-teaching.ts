import { Schema as S } from '@homingbird/kernel'
import { CHANNEL_INSTRUCTION_MAX, CHANNEL_SOURCES_MAX, ChannelDrafting } from './channel-drafting.ts'
import { Timestamp } from './ids.ts'
import { Principle } from './principles.ts'

/** Why a channel's instruction and sources cannot be saved as they are, checked by the web client and again by the server. */
export const channelInstructionProblem = (brief: {
  readonly instruction: string
  readonly sources: ReadonlyArray<string>
}): ChannelInstructionProblem | null => {
  if (brief.instruction.trim().length > CHANNEL_INSTRUCTION_MAX) return 'instruction_too_long'
  if (brief.sources.length > CHANNEL_SOURCES_MAX) return 'too_many_sources'
  const addresses = brief.sources.map(addressOf)
  return new Set(addresses).size === addresses.length ? null : 'sources_repeated'
}

export type ChannelInstructionProblem = 'instruction_too_long' | 'too_many_sources' | 'sources_repeated'

export const channelInstructionMessage = (problem: ChannelInstructionProblem): string =>
  ({
    instruction_too_long: `A channel’s instruction may have at most ${CHANNEL_INSTRUCTION_MAX} characters; link longer material as a source.`,
    too_many_sources: `A channel may name at most ${CHANNEL_SOURCES_MAX} sources.`,
    sources_repeated: 'Name each source once.',
  })[problem]

/** How a draft's instructions name a channel instruction left out because it looks like a forbidden request. */
export const CHANNEL_INSTRUCTION_TITLE = 'Channel instruction'

/** What a channel's managers taught its agent, as only they see it in the web client. */
export const ChannelTeaching = S.struct({
  ...ChannelDrafting.fields,
  updatedAt: S.nullable(Timestamp),
  principles: S.array(Principle),
  limit: S.int({ min: 1 }),
})
export type ChannelTeaching = S.Infer<typeof ChannelTeaching>

export const TaughtFrom = S.literal('edit', 'discard')
export type TaughtFrom = S.Infer<typeof TaughtFrom>

const addressOf = (source: string): string =>
  source
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')

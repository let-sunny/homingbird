import { Schema as S } from '@homingbird/kernel'
import { ChannelSlug } from './model.ts'
import { PrincipleSource } from './principle-source.ts'

export const CHANNEL_INSTRUCTION_MAX = 500
export const CHANNEL_SOURCES_MAX = 5

export const ChannelInstruction = S.string({ maxLength: CHANNEL_INSTRUCTION_MAX })
export const ChannelSources = S.array(PrincipleSource, { maxItems: CHANNEL_SOURCES_MAX })

/** The part of a channel's teaching every draft of its agent carries, besides the principles. */
export const ChannelDrafting = S.struct({
  channel: ChannelSlug,
  instruction: ChannelInstruction,
  sources: ChannelSources,
})
export type ChannelDrafting = S.Infer<typeof ChannelDrafting>

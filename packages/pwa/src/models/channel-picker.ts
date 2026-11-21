import type { AsRead } from '@homingbird/protocol'
import { channelLabel, destinationsFrom, isValidSlug, slugFrom } from '../channels.ts'
import { strings } from '../strings.ts'
import { excerpt } from '../thread.ts'

export const NEW_CHANNEL = ''

/** Where a draft can go: other channels, joined first, and a new one where allowed. */
export const pickerModel = (input: PickerInput): PickerModel => {
  const choices = destinationsFrom(input.channels, input.here)
  return {
    quote: excerpt(input.quoted, 140),
    none: choices.length === 0 ? strings.noOtherChannel : null,
    choices: choices.map((channel) => ({ value: channel.slug, label: channelLabel(channel.slug), channel })),
    mayCreate: input.channelsOn,
    first: choices[0]?.slug ?? NEW_CHANNEL,
  }
}

/** The channel to create from what was typed, or null until the name is valid; the description may be empty. */
export const newChannelFrom = (
  slug: string,
  description: string,
): { readonly slug: string; readonly description: string } | null => {
  const wanted = slugFrom(slug).replace(/-+$/, '')
  return isValidSlug(wanted) ? { slug: wanted, description: description.trim() } : null
}

export interface PickerInput {
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly here: AsRead.Channel | null
  readonly quoted: string
  readonly channelsOn: boolean
}

export interface PickerModel {
  readonly quote: string
  readonly none: string | null
  readonly choices: ReadonlyArray<{
    readonly value: string
    readonly label: string
    readonly channel: AsRead.Channel
  }>
  readonly mayCreate: boolean
  readonly first: string
}

import type { AsRead } from '@homingbird/protocol'
import { channelLabel, destinationsFrom, isPrivate, isValidSlug, slugFrom } from '../channels.ts'
import { strings } from '../strings.ts'
import { excerpt } from '../thread.ts'

export const NEW_CHANNEL = ''

/** Where a question or a draft can go: other channels, joined first, and a new one where allowed. */
export const pickerModel = (input: PickerInput): PickerModel => {
  const choices = destinationsFrom(input.channels, input.here, input.movingFrom)
  const mayCreate = input.channelsOn && (input.movingFrom === null || !isPrivate(input.movingFrom))
  return {
    quote: excerpt(input.quoted, 140),
    none: choices.length === 0 ? (mayCreate ? strings.noOtherChannel : strings.noOtherPrivateChannel) : null,
    choices: choices.map((channel) => ({ value: channel.slug, label: channelLabel(channel.slug), channel })),
    mayCreate,
    first: choices[0]?.slug ?? NEW_CHANNEL,
  }
}

/** The channel to create from what was typed, or null until both the name and a description are valid. */
export const newChannelFrom = (
  slug: string,
  description: string,
): { readonly slug: string; readonly description: string } | null => {
  const wanted = slugFrom(slug).replace(/-+$/, '')
  return !isValidSlug(wanted) || description.trim() === ''
    ? null
    : { slug: wanted, description: description.trim() }
}

export interface PickerInput {
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly here: AsRead.Channel | null
  readonly movingFrom: AsRead.Channel | null
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

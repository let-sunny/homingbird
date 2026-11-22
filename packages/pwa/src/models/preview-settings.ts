import { type AsRead, MemberId, isPerson } from '@homingbird/protocol'
import { strings } from '../strings.ts'

/**
 * "Early previews" under My agent: everyone the person could let see their agent's drafts before they
 * check them, people by name and the channels they are in, with what is allowed now ticked.
 */
export const previewSettingsModel = (input: PreviewSettingsInput): PreviewSettingsModel => {
  const allowance = input.allowance
  if (allowance === 'failed') return { kind: 'failed', text: strings.loadFailed }
  if (allowance === null) return { kind: 'loading' }
  const people = input.directory
    .filter((entry) => isPerson(entry.member) && entry.member.id !== input.me.member.id)
    .filter((entry) => entry.member.status === 'active' || allowance.people.includes(entry.member.id))
    .map((entry) => ({
      value: entry.member.id,
      label: entry.member.name,
      checked: allowance.people.includes(entry.member.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const channels = input.channels
    .filter((channel) => channel.joined)
    .map((channel) => ({
      value: channel.slug,
      label: `#${channel.slug}`,
      checked: allowance.channels.includes(channel.slug),
    }))
  return {
    kind: 'ready',
    intro: strings.draftPreviews.intro,
    people,
    noPeople: people.length === 0 ? strings.draftPreviews.noPeople : null,
    channels,
    noChannels: channels.length === 0 ? strings.draftPreviews.noChannels : null,
    summary:
      allowance.people.length + allowance.channels.length === 0
        ? strings.draftPreviews.nobody
        : strings.draftPreviews.somebody({
            people: String(allowance.people.length),
            channels: String(allowance.channels.length),
          }),
  }
}

/** The allowance a saved form asks for: the ticked people and channels, each once. */
export const allowanceFrom = (
  people: ReadonlyArray<string>,
  channels: ReadonlyArray<string>,
): AsRead.DraftPreviewAllowance => ({
  people: [...new Set(people)].filter((id): id is MemberId => MemberId.is(id)),
  channels: [...new Set(channels)],
})

export interface PreviewSettingsInput {
  readonly me: AsRead.Me
  readonly allowance: AsRead.DraftPreviewAllowance | 'failed' | null
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly channels: ReadonlyArray<AsRead.Channel>
}

export type PreviewSettingsModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly text: string }
  | {
      readonly kind: 'ready'
      readonly intro: string
      readonly people: ReadonlyArray<Choice>
      readonly noPeople: string | null
      readonly channels: ReadonlyArray<Choice>
      readonly noChannels: string | null
      readonly summary: string
    }

export interface Choice {
  readonly value: string
  readonly label: string
  readonly checked: boolean
}

import type { AsRead } from '@homingbird/protocol'
import { featureOn } from '../features.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'

/**
 * The New buttons in the list's section heads, each starting what its section lists: a note under
 * DN, and a channel under Channels where the organization has them.
 */
export const newButtonsModel = (info: AsRead.ServerInfo | null): NewButtonsModel => ({
  message: {
    label: strings.newMessageButton,
    hint: strings.hints.newMessage,
    href: hrefFor({ name: 'new', to: [] }),
  },
  browse: {
    label: strings.browseChannels,
    hint: strings.hints.browseChannels,
    href: hrefFor({ name: 'channels' }),
  },
  channel: featureOn('channels', info) ? { label: strings.newChannel, hint: strings.hints.newChannel } : null,
})

export interface NewButtonsModel {
  readonly message: { readonly label: string; readonly hint: string; readonly href: string }
  readonly browse: { readonly label: string; readonly hint: string; readonly href: string }
  readonly channel: { readonly label: string; readonly hint: string } | null
}

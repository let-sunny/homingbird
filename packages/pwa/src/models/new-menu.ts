import type { AsRead } from '@homingbird/protocol'
import { featureOn } from '../features.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'

/**
 * The New menu at the head of the list: a message, a channel or a debate room, each with one sentence
 * saying which to pick; a channel or a room only where the organization has them.
 */
export const newMenuModel = (info: AsRead.ServerInfo | null): NewMenuModel => ({
  id: 'new-menu',
  label: strings.newMenu.label,
  trigger: strings.newMenu.trigger,
  items: [
    {
      kind: 'message',
      label: strings.newMenu.message,
      hint: strings.newMenu.messageHint,
      href: hrefFor({ name: 'new', to: [] }),
    },
    ...(featureOn('channels', info)
      ? [{ kind: 'channel' as const, label: strings.newMenu.channel, hint: strings.newMenu.channelHint }]
      : []),
    ...(featureOn('debateRooms', info)
      ? [{ kind: 'debate' as const, label: strings.newMenu.debate, hint: strings.newMenu.debateHint }]
      : []),
  ],
})

export interface NewMenuModel {
  readonly id: string
  readonly label: string
  readonly trigger: string
  readonly items: ReadonlyArray<NewMenuItem>
}

export type NewMenuItem =
  | { readonly kind: 'message'; readonly label: string; readonly hint: string; readonly href: string }
  | { readonly kind: 'channel' | 'debate'; readonly label: string; readonly hint: string }

import { type Child, h, svg } from '@homingbird/ui'
import { newButtonsModel } from '../models/new-buttons.ts'
import { strings } from '../strings.ts'
import { channelCreateForm } from './channels.ts'
import type { ViewContext } from './context.ts'
import { opensDialog } from './dialog.ts'
import { hinted } from './hint.ts'

/** A plus in the head of DN: opens the new-message screen. */
export const newMessageLink = (context: ViewContext): Child => {
  const { message } = newButtonsModel(context.state.serverInfo.get())
  return hinted(
    context,
    'newMessage',
    message.hint,
    h(
      'a',
      { class: 'section-add new-message-link', href: message.href, 'aria-label': message.label },
      plusIcon(),
    ),
  )
}

/** A compass in the head of Channels: opens the page that lists every channel. */
export const browseChannelsLink = (context: ViewContext): Child => {
  const { browse } = newButtonsModel(context.state.serverInfo.get())
  return hinted(
    context,
    'browseChannels',
    browse.hint,
    h(
      'a',
      { class: 'section-add browse-channels', href: browse.href, 'aria-label': browse.label },
      compassIcon(),
    ),
  )
}

/** A plus in the head of Channels: opens the form the Channels page opens, where channels are on. */
export const newChannelButton = (context: ViewContext): Child => {
  const { channel } = newButtonsModel(context.state.serverInfo.get())
  if (channel === null) return null
  return hinted(
    context,
    'newChannel',
    channel.hint,
    h(
      'button',
      {
        type: 'button',
        class: 'section-add new-channel-link',
        'aria-label': channel.label,
        ...opensDialog(context, strings.createChannelTitle, (life) => channelCreateForm(context, life)),
      },
      plusIcon(),
    ),
  )
}

const plusIcon = (): SVGElement =>
  svg(
    'svg',
    {
      class: 'plus-icon',
      viewBox: '0 0 16 16',
      width: 16,
      height: 16,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    svg('path', {
      d: 'M8 3v10M3 8h10',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
    }),
  )

const compassIcon = (): SVGElement =>
  svg(
    'svg',
    {
      class: 'compass-icon',
      viewBox: '0 0 16 16',
      width: 16,
      height: 16,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    svg('circle', { cx: 8, cy: 8, r: 6.25, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
    svg('path', {
      d: 'M10.5 5.5 9 9 5.5 10.5 7 7z',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.25,
      'stroke-linejoin': 'round',
    }),
  )

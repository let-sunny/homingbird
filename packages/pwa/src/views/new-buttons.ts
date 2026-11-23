import { type Child, h } from '@homingbird/ui'
import { newButtonsModel } from '../models/new-buttons.ts'
import { strings } from '../strings.ts'
import { channelCreateForm } from './channels.ts'
import type { ViewContext } from './context.ts'
import { opensDialog } from './dialog.ts'
import { hinted } from './hint.ts'

/** New message, in the head of Direct messages: opens the new-message screen. */
export const newMessageLink = (context: ViewContext): Child => {
  const { message } = newButtonsModel(context.state.serverInfo.get())
  return hinted(
    context,
    'newMessage',
    message.hint,
    h('a', { class: 'section-action new-message-link', href: message.href }, message.label),
  )
}

/** New channel, in the head of Channels: opens the form the Channels page opens, where channels are on. */
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
        class: 'link section-action new-channel-link',
        ...opensDialog(context, strings.createChannelTitle, (life) => channelCreateForm(context, life)),
      },
      channel.label,
    ),
  )
}

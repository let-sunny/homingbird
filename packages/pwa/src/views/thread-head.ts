import type { Child } from '@homingbird/ui'
import { h } from '@homingbird/ui'
import type { ThreadHead } from '../models/thread-room.ts'
import { privateMark, roomControls } from './channel-membership.ts'
import type { ViewContext } from './context.ts'
import { archivedMark, backLink, channelCounts, presenceBadges } from './parts.ts'

/** The head of a conversation: who it is with, or the channel with its counts and controls. */
export const renderThreadHead = (context: ViewContext, model: ThreadHead): Child => {
  if (model.kind === 'loading') return [backLink(), h('h1', {}, model.title)]
  if (model.kind === 'people')
    return [
      backLink(),
      h(
        'div',
        { class: 'thread-who' },
        h('h1', {}, model.title),
        model.profile !== null && h('p', { class: 'thread-profile' }, model.profile),
      ),
      model.presence !== null && presenceBadges(model.presence, true),
    ]
  const channel = model.channel
  return [
    backLink(),
    h('span', { class: 'avatar is-channel', 'aria-hidden': 'true' }, '#'),
    h(
      'div',
      { class: 'thread-who' },
      h('h1', {}, model.title, channel !== null && privateMark(channel), model.archived && archivedMark()),
      channel !== null &&
        h(
          'div',
          { class: 'thread-profile channel-head-meta' },
          channelCounts(channel),
          h('span', { class: 'channel-head-description' }, channel.description),
        ),
    ),
    channel !== null && roomControls(context, channel),
  ]
}

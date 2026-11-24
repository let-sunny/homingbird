import type { Child } from '@homingbird/ui'
import { h } from '@homingbird/ui'
import type { ThreadHead } from '../models/thread-room.ts'
import { strings } from '../strings.ts'
import { channelAgentStateLine } from './channel-agent.ts'
import { answeringChip, privateMark, roomMenu } from './channel-membership.ts'
import type { ViewContext } from './context.ts'
import { threadActionsMenu } from './conversation-actions.ts'
import { muteButton, mutedMark } from './mute-toggle.ts'
import { participantsCount, participantsList, participantsTitle } from './participants.ts'
import { archivedMark, backLink, presenceDots } from './parts.ts'
import { opensProfile } from './profile-card.ts'

/** The head of a conversation on one line: who it is with, or the channel with its counts and controls. */
export const renderThreadHead = (context: ViewContext, model: ThreadHead): Child => {
  if (model.kind === 'loading') return [backLink(), h('h1', {}, model.title)]
  if (model.kind === 'people') {
    const more = threadActionsMenu(context, strings.conversationMore({ name: model.title }), model.actions)
    return [
      backLink(),
      h(
        'div',
        { class: 'thread-who' },
        h(
          'h1',
          { class: 'is-whole' },
          model.profileOf === null
            ? participantsTitle(model.people, model.title)
            : h(
                'button',
                { type: 'button', class: 'people-title', ...opensProfile(model.profileOf) },
                model.title,
              ),
          model.mute?.mark != null && mutedMark(model.mute.mark),
        ),
        (model.presence !== null || model.profile !== null) &&
          h(
            'p',
            { class: 'thread-profile' },
            model.presence !== null && presenceDots(model.presence),
            model.profile !== null && h('span', { class: 'thread-profile-text' }, model.profile),
          ),
      ),
      model.showsCount && participantsCount(model.people),
      participantsList(model.people),
      model.mute !== null && muteButton(context, model.mute),
      more !== null && [more.trigger, more.menu],
    ]
  }
  const channel = model.channel
  return [
    backLink(),
    h('span', { class: 'avatar is-channel', 'aria-hidden': 'true' }, '#'),
    h(
      'div',
      { class: 'thread-who' },
      h(
        'h1',
        {},
        model.title,
        channel !== null && privateMark(channel),
        model.archived && archivedMark(),
        model.mute?.mark != null && mutedMark(model.mute.mark),
      ),
      channel !== null &&
        h(
          'div',
          { class: 'thread-profile channel-head-meta' },
          h(
            'span',
            { class: 'channel-counts' },
            h('span', {}, participantsCount(model.people)),
            model.answerCount !== null && h('span', {}, model.answerCount),
          ),
          model.agentState !== null && channelAgentStateLine(model.agentState),
        ),
      channel === null && participantsCount(model.people),
      channel !== null &&
        model.slackLink !== null &&
        h(
          'p',
          { class: 'slack-link-line hint' },
          h('span', {}, model.slackLink.text),
          model.slackLink.unlink !== null &&
            h(
              'button',
              {
                type: 'button',
                class: 'link-button',
                on: {
                  click: () =>
                    context.actions.unlinkSlackChannel(channel.slug, {
                      done: () => context.actions.reloadKnownChannels(),
                    }),
                },
              },
              model.slackLink.unlink,
            ),
        ),
    ),
    participantsList(model.people),
    channel !== null && h('span', { class: 'thread-answering' }, answeringChip(context, channel)),
    model.mute !== null && muteButton(context, model.mute),
    channel !== null && roomMenu(context, channel),
  ]
}

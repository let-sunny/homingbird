import type { Child } from '@homingbird/ui'
import { h } from '@homingbird/ui'
import type { GroupPeople, ThreadHead } from '../models/thread-room.ts'
import type { PresenceMarks } from '../presence.ts'
import { channelAgentStateLine } from './channel-agent.ts'
import { answeringChip, privateMark, roomMenu } from './channel-membership.ts'
import type { ViewContext } from './context.ts'
import { muteButton, mutedMark } from './mute-toggle.ts'
import { archivedMark, backLink, channelCounts, youMark } from './parts.ts'

/** The head of a conversation on one line: who it is with, or the channel with its counts and controls. */
export const renderThreadHead = (context: ViewContext, model: ThreadHead): Child => {
  if (model.kind === 'loading') return [backLink(), h('h1', {}, model.title)]
  if (model.kind === 'people')
    return [
      backLink(),
      h(
        'div',
        { class: 'thread-who' },
        h('h1', { class: 'is-whole' }, model.title, model.mute?.mark != null && mutedMark(model.mute.mark)),
        (model.presence !== null || model.profile !== null) &&
          h(
            'p',
            { class: 'thread-profile' },
            model.presence !== null && presenceDots(model.presence),
            model.profile !== null && h('span', { class: 'thread-profile-text' }, model.profile),
          ),
      ),
      model.people !== null && groupPeople(model.people),
      model.mute !== null && muteButton(context, model.mute),
    ]
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
          channelCounts(channel),
          model.agentState !== null && channelAgentStateLine(model.agentState),
        ),
    ),
    channel !== null && h('span', { class: 'thread-answering' }, answeringChip(context, channel)),
    model.mute !== null && muteButton(context, model.mute),
    channel !== null && roomMenu(context, channel),
  ]
}

/** How many people are in a group message, and a button that lists them. */
const groupPeople = (model: GroupPeople): Child => [
  h('button', { type: 'button', class: 'group-people-open', popovertarget: GROUP_PEOPLE_ID }, model.label),
  h(
    'div',
    { id: GROUP_PEOPLE_ID, class: 'menu group-people', popover: 'auto', 'aria-label': model.title },
    h('p', { class: 'menu-who' }, h('strong', {}, model.title)),
    h(
      'ul',
      {},
      model.people.map((person) => h('li', {}, person.name, person.you && [' ', youMark()])),
    ),
  ),
]

/** The colleague and their agent as two dots, each named for assistive technology and on hover. */
const presenceDots = (marks: PresenceMarks): HTMLElement =>
  h(
    'span',
    { class: 'presence-dots' },
    h('span', {
      class: `human-dot ${marks.person.isOn ? 'is-on' : 'is-off'}`,
      role: 'img',
      'aria-label': marks.person.label,
      title: marks.person.label,
    }),
    h('span', {
      class: `agent-mark-dot is-${marks.agent.state}`,
      role: 'img',
      'aria-label': marks.agent.label,
      title: marks.agent.label,
    }),
    h('span', { class: 'presence-words', 'aria-hidden': 'true' }, marks.words),
  )

const GROUP_PEOPLE_ID = 'group-people'

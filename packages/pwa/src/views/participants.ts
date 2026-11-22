import { h } from '@homingbird/ui'
import type { Participants } from '../models/participants.ts'
import { youMark } from './parts.ts'

/**
 * Everyone in a conversation, as a menu that its head's names and count open: each person with what they
 * are here. On a touch screen it is the sheet along the bottom edge that every menu there is.
 */
export const participantsList = (model: Participants): HTMLElement =>
  h(
    'div',
    { id: model.id, class: 'menu action-menu people-list', popover: 'auto', 'aria-label': model.title },
    h('p', { class: 'menu-who' }, h('strong', {}, model.title)),
    h(
      'ul',
      {},
      model.people.map((person) =>
        h(
          'li',
          { class: 'participant', data: { member: person.memberId } },
          h('span', { class: 'participant-name' }, person.name, person.you && [' ', youMark()]),
          person.roles.length > 0 &&
            h(
              'span',
              { class: 'participant-roles' },
              person.roles.map((role) => h('small', {}, role)),
            ),
        ),
      ),
    ),
    model.note !== null && h('p', { class: 'hint people-later' }, model.note),
  )

/** The button that says how many are in the conversation and opens the list of them. */
export const participantsCount = (model: Participants): HTMLElement =>
  h(
    'button',
    { type: 'button', class: 'people-open', popovertarget: model.id, title: model.summary },
    model.label,
  )

/** A conversation's name in its head, which opens the list of everyone the name stands for. */
export const participantsTitle = (model: Participants, title: string): HTMLElement =>
  h('button', { type: 'button', class: 'people-title', popovertarget: model.id, title: model.summary }, title)

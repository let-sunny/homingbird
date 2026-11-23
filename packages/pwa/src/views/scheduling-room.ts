import { h } from '@homingbird/ui'
import type { SchedulingRoomModel } from '../models/scheduling-room.ts'
import { strings } from '../strings.ts'
import { section } from './debate-result.ts'
import { page, privateMarkOf } from './parts.ts'
import { profileName } from './profile-card.ts'
import { renderScheduleResult } from './schedule-result.ts'

/**
 * A scheduling flock, leading with one thing: the time it settled on, or while it waits, what the person can
 * do about it (picking free times, adding the meeting), drawn by the caller. Who has answered comes after.
 */
export const renderSchedulingRoom = (
  model: SchedulingRoomModel,
  cards: ReadonlyArray<HTMLElement | null> = [],
): HTMLElement => {
  if (model.kind === 'unsupported')
    return page(strings.scheduling.kind, h('p', { class: 'hint' }, model.text))
  return page(
    model.title,
    h(
      'p',
      { class: `debate-meta is-${model.stage}` },
      h('span', { class: 'debate-stage' }, model.stageText),
      model.isPrivate && privateMarkOf(strings.debates.private, strings.debates.privateSeenBy),
      model.summary.map((line) => h('span', {}, line)),
    ),
    model.deadline !== null && h('p', { class: 'scheduling-deadline' }, model.deadline),
    model.result.kind === 'settled'
      ? section(model.resultTitle, 'debate-result scheduling-result', renderScheduleResult(model.result.body))
      : h('p', { class: 'hint scheduling-result-waiting' }, model.result.text),
    cards,
    section(
      model.attendeesTitle,
      'scheduling-attendees',
      h('p', { class: 'scheduling-answered' }, model.answered),
      h(
        'ul',
        { class: 'scheduling-attendee-list' },
        model.attendees.map((attendee) =>
          h(
            'li',
            { class: attendee.answered ? 'is-answered' : '', data: { member: attendee.memberId } },
            h('strong', {}, profileName(attendee.memberId, attendee.name)),
            h('small', {}, attendee.required),
            h('span', {}, attendee.answer),
            attendee.part !== null && h('span', { class: 'scheduling-attendee-part' }, attendee.part),
          ),
        ),
      ),
    ),
  )
}

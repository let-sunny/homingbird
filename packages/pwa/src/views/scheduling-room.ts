import { h } from '@homingbird/ui'
import type { SchedulingRoomModel } from '../models/scheduling-room.ts'
import { strings } from '../strings.ts'
import { section } from './debate-result.ts'
import { page, privateMarkOf } from './parts.ts'
import { profileName } from './profile-card.ts'
import { renderScheduleResult } from './schedule-result.ts'

/** A scheduling room: who has answered, the deadline, and the time the room settled on. */
export const renderSchedulingRoom = (model: SchedulingRoomModel): HTMLElement => {
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
          ),
        ),
      ),
    ),
    section(
      model.resultTitle,
      'debate-result scheduling-result',
      model.result.kind === 'settled'
        ? renderScheduleResult(model.result.body)
        : h('p', { class: 'hint' }, model.result.text),
    ),
  )
}

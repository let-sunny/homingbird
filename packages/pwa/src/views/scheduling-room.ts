import { type Lifetime, type ReadableSignal, h } from '@homingbird/ui'
import type { SchedulingRoomModel } from '../models/scheduling-room.ts'
import { strings } from '../strings.ts'
import { type Block, blocks } from './blocks.ts'
import { section } from './debate-result.ts'
import { page, privateMarkOf } from './parts.ts'
import { profileName } from './profile-card.ts'
import { renderScheduleResult } from './schedule-result.ts'

/**
 * A scheduling flock, leading with one thing: the time it settled on, or while it waits, what the person can
 * do about it (picking free times, adding the meeting), drawn by the caller. Who has answered comes after.
 * Each part is drawn again only when what it shows changes.
 */
export const renderSchedulingRoom = (
  life: Lifetime,
  source: ReadableSignal<unknown>,
  modelNow: () => SchedulingRoomModel,
  cards: () => ReadonlyArray<Block | null> = () => [],
): HTMLElement => {
  const model = modelNow()
  if (model.kind === 'unsupported')
    return page(strings.scheduling.kind, h('p', { class: 'hint' }, model.text))
  const shown = page(model.title)
  blocks(life, shown.querySelector<HTMLElement>('.page-body')!, source, () => {
    const now = modelNow()
    return now.kind === 'room' ? partsOf(now, cards()) : []
  })
  return shown
}

const partsOf = (
  model: Extract<SchedulingRoomModel, { kind: 'room' }>,
  cards: ReadonlyArray<Block | null>,
): ReadonlyArray<Block | null> => {
  const { deadline, result } = model
  return [
    {
      key: 'meta',
      from: [model.stage, model.stageText, model.isPrivate, model.summary],
      draw: () =>
        h(
          'p',
          { class: `debate-meta is-${model.stage}` },
          h('span', { class: 'debate-stage' }, model.stageText),
          model.isPrivate && privateMarkOf(strings.debates.private, strings.debates.privateSeenBy),
          model.summary.map((line) => h('span', {}, line)),
        ),
    },
    deadline === null
      ? null
      : { key: 'deadline', from: deadline, draw: () => h('p', { class: 'scheduling-deadline' }, deadline) },
    {
      key: 'result',
      from: [model.resultTitle, result],
      draw: () =>
        result.kind === 'settled'
          ? section(model.resultTitle, 'debate-result scheduling-result', renderScheduleResult(result.body))
          : h('p', { class: 'hint scheduling-result-waiting' }, result.text),
    },
    ...cards,
    {
      key: 'attendees',
      from: [model.attendeesTitle, model.answered, model.attendees],
      draw: () => attendeesSection(model),
    },
  ]
}

const attendeesSection = (model: Extract<SchedulingRoomModel, { kind: 'room' }>): HTMLElement =>
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
  )

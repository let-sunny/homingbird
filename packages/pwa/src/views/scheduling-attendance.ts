import type { AsRead, MemberId } from '@homingbird/protocol'
import { h } from '@homingbird/ui'
import { schedulingAttendanceModel } from '../models/scheduling-attendance.ts'
import { hrefFor } from '../routes.ts'
import type { ViewContext } from './context.ts'
import { section } from './debate-result.ts'

/** What a person can do about the settled meeting: add it, say they did, take it out, open its link. */
export const schedulingAttendanceCard = (
  context: ViewContext,
  input: {
    readonly debate: AsRead.Debate
    readonly viewerId: MemberId
    readonly hasAgent: boolean
    readonly members: ReadonlyMap<MemberId, AsRead.Member>
  },
): HTMLElement | null => {
  const { debate } = input
  const model = schedulingAttendanceModel({ ...input, now: context.clock.now() })
  if (model === null) return null
  const file = model.calendarFile
  return section(
    model.title,
    'scheduling-attendance',
    h('p', { class: 'scheduling-attendance-status' }, model.status),
    model.meetingUrl !== null &&
      h(
        'p',
        {},
        h(
          'a',
          {
            class: 'scheduling-meeting-link',
            href: model.meetingUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          model.meetingLinkLabel,
        ),
      ),
    h(
      'div',
      { class: 'scheduling-attendance-actions' },
      model.actions.map((action) =>
        h(
          'button',
          {
            type: 'button',
            class: `${action.emphasis === 'primary' ? 'primary ' : ''}scheduling-${action.name}`,
            on: {
              click: () =>
                action.name === 'add'
                  ? context.actions.addMeeting(debate.id, { attempt: 'meeting' })
                  : context.actions.removeMeeting(debate.id, { attempt: 'meeting' }),
            },
          },
          action.label,
        ),
      ),
      file !== null &&
        h(
          'button',
          {
            type: 'button',
            class: 'scheduling-calendar-file',
            on: { click: () => context.page.download(file) },
          },
          model.calendarFileLabel,
        ),
    ),
    model.removeHint !== null && h('small', { class: 'hint' }, model.removeHint),
    model.delegation !== null &&
      h(
        'p',
        { class: 'hint scheduling-delegation' },
        `${model.delegation.text} `,
        h('a', { href: hrefFor({ name: 'profile' }) }, model.delegation.changeLabel),
      ),
  )
}

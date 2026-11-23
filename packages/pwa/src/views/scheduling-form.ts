import { type AsRead, DEBATE_QUESTION_MAX, type MemberId } from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import { candidatesAmong } from '../models/people-picker.ts'
import { scheduleSetupFrom, schedulingFormModel, withOptional } from '../models/scheduling-form.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog } from './dialog.ts'
import { field } from './parts.ts'
import { peoplePicker } from './people-picker.ts'

/**
 * The form that opens a scheduling room: a title, the people who should come, each required unless marked
 * optional, how long the meeting is, and the days a time is looked for.
 */
export const schedulingForm = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  const chosen = signal<ReadonlyArray<MemberId>>([])
  const optional = signal<ReadonlySet<MemberId>>(new Set())
  const nameOf = (id: MemberId): string => state.members.get().get(id)?.name ?? strings.formerMember
  const model = () =>
    schedulingFormModel({ now: context.clock.now(), chosen: chosen.get(), optional: optional.get(), nameOf })
  const start = model()
  const title = h('input', {
    type: 'text',
    name: 'title',
    required: true,
    maxlength: String(DEBATE_QUESTION_MAX),
    placeholder: strings.scheduling.titlePlaceholder,
  })
  const length = h(
    'select',
    { name: 'minutes' },
    ...start.lengths.map((choice) =>
      h('option', { value: String(choice.value), selected: choice.selected }, choice.label),
    ),
  )
  const earliest = h('input', { type: 'date', name: 'earliestDay', required: true, value: start.earliestDay })
  const latest = h('input', { type: 'date', name: 'latestDay', required: true, value: start.latestDay })
  const picker = peoplePicker(life, {
    id: 'scheduling-attendees',
    label: strings.scheduling.attendees,
    placeholder: strings.newMessage.placeholder,
    candidates: () => candidatesAmong(state.directory.get(), new Set([me.member.id])),
    sources: [state.directory],
    chosen,
    limit: start.maxAttendees,
  })
  return h(
    'form',
    {
      class: 'dialog-body scheduling-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const typed = scheduleSetupFrom(
            {
              title: title.value,
              minutes: length.value,
              earliestDay: earliest.value,
              latestDay: latest.value,
              chosen: chosen.get(),
              optional: optional.get(),
            },
            context.clock.now(),
          )
          if ('problem' in typed) return state.notice.set({ kind: 'error', text: typed.problem })
          state.notice.set(null)
          actions.createSchedulingRoom(typed.setup, {
            done: (created) => {
              closeDialog(context)
              context.page.go(hrefFor({ name: 'debate', id: created.id, tab: null }))
            },
          })
        },
      },
    },
    field(strings.scheduling.titleLabel, title),
    h(
      'div',
      { class: 'scheduling-attendee-field' },
      picker.element,
      h('small', {}, strings.scheduling.attendeesHint),
    ),
    region(life, [chosen, optional, state.members], () =>
      h(
        'ul',
        { class: 'scheduling-optional-list' },
        model().attendees.map((attendee) =>
          h(
            'li',
            { data: { member: attendee.memberId } },
            h(
              'label',
              {},
              h('input', {
                type: 'checkbox',
                checked: attendee.optional,
                on: {
                  change: (event) =>
                    optional.set(
                      withOptional(
                        optional.get(),
                        attendee.memberId,
                        (event.target as HTMLInputElement).checked,
                      ),
                    ),
                },
              }),
              h('span', {}, attendee.label),
            ),
          ),
        ),
      ),
    ),
    field(strings.scheduling.length, length),
    h(
      'fieldset',
      { class: 'scheduling-days' },
      field(strings.scheduling.earliestDay, earliest),
      field(strings.scheduling.latestDay, latest),
      h('small', { class: 'hint' }, start.windowHint),
    ),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      h('button', { type: 'submit', class: 'primary' }, strings.scheduling.create),
    ),
  )
}

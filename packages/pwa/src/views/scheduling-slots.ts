import type { AsRead, MemberId } from '@homingbird/protocol'
import { type Lifetime, type Signal, h, region, signal } from '@homingbird/ui'
import { type SchedulingSlotsModel, schedulingSlotsModel } from '../models/scheduling-slots.ts'
import type { ViewContext } from './context.ts'
import { section } from './debate-result.ts'

/**
 * The card on which a person ticks the hours they are free. The ticks live in `picked`, which the room
 * view keeps, so that drawing the room again while the person picks does not lose them.
 */
export const schedulingSlotsCard = (
  context: ViewContext,
  life: Lifetime,
  input: {
    readonly debate: AsRead.Debate
    readonly viewerId: MemberId
    readonly picked: Signal<ReadonlySet<number> | null>
  },
): HTMLElement | null => {
  const { debate, picked } = input
  const showsAll = signal(false)
  const modelOf = (chosen: ReadonlySet<number> | null): SchedulingSlotsModel | null =>
    schedulingSlotsModel({
      debate,
      viewerId: input.viewerId,
      now: context.clock.now(),
      timeZone: context.page.timeZone(),
      showAllHours: showsAll.get(),
      ...(chosen !== null && { chosen }),
    })
  const first = modelOf(picked.get())
  if (first === null) return null
  const sendTimes = (slots: SchedulingSlotsModel['slots']): void =>
    context.actions.setMyFreeTimes(debate.id, slots, { done: () => picked.set(null) })
  return section(
    first.title,
    'scheduling-pick',
    h('p', { class: 'hint' }, first.hint),
    first.limitsHint !== null && h('p', { class: 'hint scheduling-pick-limits' }, first.limitsHint),
    first.answered !== null && h('p', { class: 'hint' }, first.answered),
    first.emptyText !== null && h('p', { class: 'hint' }, first.emptyText),
    region(life, [showsAll], () => {
      const shown = modelOf(picked.get()) ?? first
      return h(
        'div',
        { class: 'scheduling-pick-hours' },
        shown.workingHint !== null && h('p', { class: 'hint scheduling-pick-working' }, shown.workingHint),
        shown.hoursToggle !== null &&
          h(
            'button',
            {
              type: 'button',
              class: 'scheduling-pick-hours-toggle',
              on: { click: () => showsAll.set(shown.hoursToggle?.showsAll ?? false) },
            },
            shown.hoursToggle.label,
          ),
        h(
          'div',
          { class: 'scheduling-pick-days' },
          shown.days.map((day) =>
            h(
              'fieldset',
              { class: 'scheduling-pick-day' },
              h('legend', {}, day.day),
              h(
                'div',
                { class: 'scheduling-pick-cells' },
                day.cells.map((cell) =>
                  h(
                    'label',
                    { class: 'scheduling-pick-cell' },
                    h('input', {
                      type: 'checkbox',
                      data: { start: String(cell.startsAt) },
                      checked: cell.chosen,
                      on: {
                        change: (event) => {
                          const next = new Set(picked.get() ?? shown.chosenStarts)
                          if ((event.target as HTMLInputElement).checked) next.add(cell.startsAt)
                          else next.delete(cell.startsAt)
                          picked.set(next)
                        },
                      },
                    }),
                    h('span', {}, cell.label),
                  ),
                ),
              ),
            ),
          ),
        ),
      )
    }),
    region(life, [picked], () => {
      const current = modelOf(picked.get()) ?? first
      return h(
        'div',
        { class: 'scheduling-pick-actions' },
        h('p', { class: 'scheduling-pick-count' }, current.count),
        current.problem !== null && h('p', { class: 'hint' }, current.problem),
        h(
          'button',
          {
            type: 'button',
            class: 'primary scheduling-pick-send',
            disabled: current.sendDisabled,
            on: { click: () => sendTimes(current.slots) },
          },
          current.send,
        ),
        h(
          'button',
          { type: 'button', class: 'scheduling-pick-busy', on: { click: () => sendTimes([]) } },
          current.busy,
        ),
        h('small', { class: 'hint' }, current.busyHint),
      )
    }),
  )
}

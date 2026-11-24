import type { AsRead, SchedulingDelegationView } from '@homingbird/protocol'
import { type Lifetime, h, region, signal, slice } from '@homingbird/ui'
import { delegationFrom, schedulingSettingsModel } from '../models/scheduling-settings.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { loading } from './parts.ts'

/** "Your agent and meetings" in Settings: how the person's agent joins and adds meetings for them. */
export const schedulingSettingsSection = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
): HTMLElement => {
  const { state, actions, page } = context
  const view = signal<SchedulingDelegationView | 'failed' | null>(null)
  const changingAgent = signal(false)
  const saved = signal(false)
  actions.loadPeople()
  actions.loadAgents()
  actions.loadSchedulingDelegation({
    done: (read) => view.set(read),
    failed: () => view.set('failed'),
  })
  const shown = slice([view, state.directory, state.agentCredentials], () =>
    schedulingSettingsModel({
      me,
      view: view.get(),
      agents: state.agentCredentials.get(),
      directory: state.directory.get(),
      timeZone: page.timeZone(),
    }),
  )
  return region(
    life,
    [shown],
    (drawing) => {
      const model = shown.get()
      if (model.kind === 'loading') return loading()
      if (model.kind === 'failed') return h('p', { class: 'hint' }, model.text)
      const before = (view.get() as SchedulingDelegationView).delegation
      return h(
        'form',
        {
          class: 'form scheduling-settings',
          on: {
            submit: (event) => {
              event.preventDefault()
              const form = event.currentTarget as HTMLFormElement
              const typed = delegationFrom(
                {
                  autoJoin: checked(form, 'autoJoin'),
                  autoAdd: checked(form, 'autoAdd'),
                  agentId: form.querySelector<HTMLSelectElement>('select[name="agent"]')?.value ?? null,
                  peopleLimited: checked(form, 'peopleLimited'),
                  people: [...form.querySelectorAll<HTMLInputElement>('input[name="person"]:checked')].map(
                    (box) => box.value,
                  ),
                  hoursLimited: checked(form, 'hoursLimited'),
                  from: valueOf(form, 'from'),
                  to: valueOf(form, 'to'),
                  maxLimited: checked(form, 'maxLimited'),
                  maxMinutes: valueOf(form, 'maxMinutes'),
                  brief: valueOf(form, 'brief'),
                },
                before,
                page.timeZone(),
              )
              if ('problem' in typed) return state.notice.set({ kind: 'error', text: typed.problem })
              actions.saveSchedulingDelegation(typed.delegation, {
                done: (stored) => {
                  saved.set(true)
                  changingAgent.set(false)
                  view.set(stored)
                },
              })
            },
          },
        },
        h('h3', {}, model.title),
        model.summary.map((line) => h('p', { class: 'hint scheduling-settings-summary' }, line)),
        toggle('autoJoin', model.join),
        toggle('autoAdd', model.add),
        h(
          'div',
          { class: 'scheduling-agent' },
          h('span', {}, model.agentLine),
          region(drawing, [changingAgent], () =>
            changingAgent.get()
              ? h(
                  'label',
                  { class: 'scheduling-agent-choice' },
                  h('span', {}, strings.scheduling.delegation.agentLabel),
                  h(
                    'select',
                    { name: 'agent' },
                    model.agentChoices.map((choice) =>
                      h('option', { value: choice.value, selected: choice.selected }, choice.label),
                    ),
                  ),
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    class: 'scheduling-agent-change',
                    on: { click: () => changingAgent.set(true) },
                  },
                  strings.scheduling.delegation.agentChange,
                ),
          ),
        ),
        h(
          'fieldset',
          { class: 'scheduling-limits' },
          h('legend', {}, strings.scheduling.delegation.limitsLegend),
          h('p', { class: 'hint' }, strings.scheduling.delegation.limitsHint),
          limit('peopleLimited', strings.scheduling.delegation.peopleLimited, model.people.limited, [
            model.people.choices.length === 0
              ? h('p', { class: 'hint' }, strings.scheduling.delegation.noPeople)
              : model.people.choices.map((choice) =>
                  h(
                    'label',
                    { class: 'choice' },
                    h('input', {
                      type: 'checkbox',
                      name: 'person',
                      value: choice.value,
                      checked: choice.checked,
                    }),
                    h('span', {}, choice.label),
                  ),
                ),
            h('small', { class: 'hint' }, strings.scheduling.delegation.peopleHint),
          ]),
          limit('hoursLimited', strings.scheduling.delegation.hoursLimited, model.hours.limited, [
            h(
              'div',
              { class: 'scheduling-hours' },
              h(
                'label',
                {},
                h('span', {}, strings.scheduling.delegation.hoursFrom),
                h('input', { type: 'time', name: 'from', value: model.hours.from }),
              ),
              h(
                'label',
                {},
                h('span', {}, strings.scheduling.delegation.hoursTo),
                h('input', { type: 'time', name: 'to', value: model.hours.to }),
              ),
            ),
            h('small', { class: 'hint' }, model.hours.zoneNote),
          ]),
          limit('maxLimited', strings.scheduling.delegation.maxLimited, model.maxMinutes.limited, [
            h(
              'select',
              { name: 'maxMinutes', 'aria-label': strings.scheduling.delegation.maxLimited },
              model.maxMinutes.choices.map((choice) =>
                h('option', { value: String(choice.value), selected: choice.selected }, choice.label),
              ),
            ),
          ]),
        ),
        h(
          'label',
          { class: 'scheduling-brief' },
          h('span', {}, strings.scheduling.delegation.briefLabel),
          h('textarea', { name: 'brief', rows: '3', maxlength: '1000' }, model.brief),
          h('small', { class: 'hint' }, strings.scheduling.delegation.briefHint),
        ),
        region(drawing, [saved], () =>
          h('p', { class: 'hint', role: 'status' }, saved.get() ? strings.scheduling.delegation.saved : null),
        ),
        h('button', { type: 'submit', class: 'primary' }, strings.scheduling.delegation.save),
      )
    },
    { class: 'scheduling-settings-host' },
  )
}

const toggle = (
  name: string,
  option: { readonly checked: boolean; readonly label: string; readonly hint: string },
): HTMLElement =>
  h(
    'label',
    { class: 'choice' },
    h('input', { type: 'checkbox', name, checked: option.checked }),
    h('span', {}, option.label, h('small', {}, option.hint)),
  )

const limit = (
  name: string,
  label: string,
  isOn: boolean,
  details: ReadonlyArray<HTMLElement | ReadonlyArray<HTMLElement>>,
): HTMLElement =>
  h(
    'div',
    { class: 'scheduling-limit' },
    h(
      'label',
      { class: 'choice' },
      h('input', { type: 'checkbox', name, checked: isOn }),
      h('span', {}, label),
    ),
    h('div', { class: 'scheduling-limit-details' }, ...details),
  )

const checked = (form: HTMLFormElement, name: string): boolean =>
  form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked ?? false

const valueOf = (form: HTMLFormElement, name: string): string =>
  form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? ''

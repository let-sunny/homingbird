import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, type ReadableSignal, h, region, signal } from '@homingbird/ui'
import type { CloudDeskPresetId } from '../cloud-desk-presets.ts'
import { type CloudDeskModel, cloudDeskModel, deskWakeSetupFrom } from '../models/cloud-desk.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, field, loading } from './parts.ts'

/** "Cloud desk" under Connection: set up the address that wakes a desk in a cloud agent service. */
export const cloudDeskSection = (
  context: ViewContext,
  life: Lifetime,
  credentials: ReadableSignal<ReadonlyArray<AsRead.Credential> | null>,
): HTMLElement => {
  const wake = signal<AsRead.DeskWake | null | undefined>(undefined)
  const preset = signal<CloudDeskPresetId>('routine')
  const tested = signal<AsRead.DeskWakeTest | null>(null)
  context.actions.loadDeskWake({ done: (read) => wake.set(read) })
  const model = (): CloudDeskModel =>
    cloudDeskModel({
      wake: wake.get(),
      credentials: credentials.get(),
      preset: preset.get(),
      tested: tested.get(),
    })
  const actions: CloudDeskActions = {
    choose: (chosen) => preset.set(chosen),
    saved: (saved) => {
      tested.set(null)
      wake.set(saved)
    },
    tested: (outcome) => tested.set(outcome),
    removed: () => {
      tested.set(null)
      wake.set(null)
    },
  }
  return h(
    'fieldset',
    { class: 'appearance cloud-desk' },
    h('legend', {}, strings.cloudDesk.legend),
    h('p', { class: 'hint' }, strings.cloudDesk.intro),
    region(life, [wake, tested, credentials], () => renderState(model(), context, actions), {
      class: 'cloud-desk-state',
    }),
    region(life, [wake, credentials, preset], () => renderForm(model(), context, actions), {
      class: 'cloud-desk-setup',
    }),
    promptPart(),
  )
}

interface CloudDeskActions {
  readonly choose: (preset: CloudDeskPresetId) => void
  readonly saved: (wake: AsRead.DeskWake) => void
  readonly tested: (outcome: AsRead.DeskWakeTest) => void
  readonly removed: () => void
}

const renderState = (model: CloudDeskModel, context: ViewContext, actions: CloudDeskActions): Child => {
  if (model.loading) return loading()
  if (model.status === null) return null
  return [
    h('p', { class: `cloud-desk-status ${model.status.tone}`, role: 'status' }, model.status.text),
    h(
      'dl',
      { class: 'facts' },
      model.facts.map((fact) => [h('dt', {}, fact.term), h('dd', {}, fact.value)]),
    ),
    h(
      'div',
      { class: 'cloud-desk-actions' },
      button(strings.cloudDesk.test, () => context.actions.testDeskWake({ done: actions.tested }), {
        title: strings.cloudDesk.testHint,
      }),
      h(
        'button',
        {
          type: 'button',
          class: 'danger',
          ...opensDialog(context, strings.cloudDesk.removeTitle, () => removeConfirmation(context, actions)),
        },
        strings.cloudDesk.remove,
      ),
    ),
    model.tested !== null && h('p', { class: 'cloud-desk-tested', role: 'status' }, model.tested),
  ]
}

const renderForm = (model: CloudDeskModel, context: ViewContext, actions: CloudDeskActions): Child => {
  if (model.loading) return null
  const url = h('input', {
    name: 'url',
    type: 'url',
    required: true,
    autocomplete: 'off',
    maxlength: '2000',
    placeholder: model.urlPlaceholder,
  })
  const agent = h(
    'select',
    { name: 'credential', required: true },
    model.agents.map((option) =>
      h('option', { value: option.value, selected: option.selected }, option.label),
    ),
  )
  const rows = model.headers.map((header, index) => ({
    name: h('input', {
      name: `header-name-${index}`,
      autocomplete: 'off',
      maxlength: '64',
      value: header.name,
      'aria-label': strings.cloudDesk.headerName({ number: String(index + 1) }),
    }),
    value: h('input', {
      name: `header-value-${index}`,
      type: 'password',
      autocomplete: 'off',
      maxlength: '4000',
      value: header.value,
      placeholder: header.placeholder,
      'aria-label': strings.cloudDesk.headerValue({ number: String(index + 1) }),
    }),
  }))
  const enabled = h('input', { name: 'enabled', type: 'checkbox', checked: model.enabled })
  return h(
    'form',
    {
      class: 'form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const setup = deskWakeSetupFrom({
            url: url.value,
            headers: rows.map((row) => ({ name: row.name.value, value: row.value.value })),
            credentialId: agent.value,
            enabled: enabled.checked,
          })
          context.actions.saveDeskWake(setup, { done: actions.saved })
        },
      },
    },
    h(
      'fieldset',
      { class: 'cloud-desk-presets' },
      h('legend', {}, strings.cloudDesk.service),
      model.presets.map((option) =>
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'radio',
            name: 'cloud-desk-preset',
            value: option.value,
            checked: option.checked,
            on: { change: () => actions.choose(option.value) },
          }),
          h('span', {}, option.label),
        ),
      ),
      h('p', { class: 'hint' }, model.presetNote),
    ),
    model.noAgent !== null
      ? h('p', { class: 'hint no-agents' }, model.noAgent)
      : field(strings.cloudDesk.agent, agent, strings.cloudDesk.agentHint),
    field(strings.cloudDesk.url, url, strings.cloudDesk.urlHint),
    h(
      'div',
      { class: 'cloud-desk-headers' },
      rows.map((row) => h('div', { class: 'cloud-desk-header' }, row.name, row.value)),
      h('small', {}, strings.cloudDesk.headersHint),
    ),
    h('label', { class: 'choice' }, enabled, h('span', {}, strings.cloudDesk.enabled)),
    model.replaceHint !== null && h('p', { class: 'hint' }, model.replaceHint),
    h(
      'button',
      { type: 'submit', class: 'primary', disabled: model.noAgent !== null },
      strings.cloudDesk.save,
    ),
  )
}

const promptPart = (): HTMLElement => {
  const prompt = h('textarea', { readonly: true, rows: '6', class: 'cloud-desk-prompt' })
  prompt.value = strings.cloudDesk.promptText
  return h(
    'div',
    { class: 'cloud-desk-guidance' },
    field(strings.cloudDesk.prompt, prompt, strings.cloudDesk.promptHint),
    h('p', { class: 'hint' }, strings.cloudDesk.graceAdvice),
  )
}

const removeConfirmation = (context: ViewContext, actions: CloudDeskActions): Child =>
  h(
    'div',
    { class: 'dialog-body' },
    h('p', {}, strings.cloudDesk.removeBody),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      button(
        strings.cloudDesk.remove,
        () =>
          context.actions.removeDeskWake({
            done: () => {
              closeDialog(context)
              actions.removed()
            },
          }),
        { class: 'danger' },
      ),
    ),
  )

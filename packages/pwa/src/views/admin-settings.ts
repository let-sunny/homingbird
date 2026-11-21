import { type AsRead, type FeatureName, type FlowStep, featureSwitches } from '@homingbird/protocol'
import { type Lifetime, type Signal, h, region, signal } from '@homingbird/ui'
import { flowToSave, moveStep, stepsFrom } from '../answering-flow.ts'
import { contactModeChoices, contactModeToSave } from '../contact-mode.ts'
import { featureOn } from '../features.ts'
import { domainsFrom, featureRows, flowToolsModel, whoCanInviteChoices } from '../models/admin.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { field, loading } from './parts.ts'
import { todoList } from './todo-list.ts'

/** Administration → Settings: who may sign in, how people reach each other, the answering flow, features. */
export const settingsSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const settings = signal<AsRead.Settings | null>(null)
  context.actions.loadSettings({ done: (loaded) => settings.set(loaded) })
  return region(life, [settings], () => {
    const loaded = settings.get()
    return loaded === null ? loading() : settingsForm(context, life, loaded)
  })
}

const settingsForm = (context: ViewContext, life: Lifetime, settings: AsRead.Settings): HTMLElement => {
  const { state, actions } = context
  const flowOn = featureOn('answeringFlow', state.serverInfo.get())
  const invitesOn = featureOn('invites', state.serverInfo.get())
  const inviters = h(
    'select',
    { name: 'whoCanInvite' },
    whoCanInviteChoices(settings.whoCanInvite).map((choice) =>
      h('option', { value: choice.value, selected: choice.selected }, choice.label),
    ),
  )
  const problem = signal<string | null>(null)
  const domains = h('textarea', { name: 'domains', rows: '4' })
  domains.value = settings.allowedDomains.join('\n')
  const save = h('button', { type: 'submit', class: 'primary' }, strings.save)
  const mode = h(
    'select',
    { name: 'contactMode', on: { change: () => (save.disabled = contactModeToSave(mode.value) === null) } },
    contactModeChoices(settings.contactMode).map((choice) =>
      h(
        'option',
        { value: choice.value, selected: choice.selected, disabled: choice.disabled },
        choice.label,
      ),
    ),
  )
  save.disabled = contactModeToSave(mode.value) === null
  const flow = answeringFlowEditor(life, settings.answeringFlow ?? null, problem)
  const features = featureSwitchesEditor(life, settings.features ?? {})
  return h(
    'form',
    {
      class: 'form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const contactMode = contactModeToSave(mode.value)
          if (contactMode === null) return
          problem.set(null)
          actions.saveSettings(
            {
              allowedDomains: domainsFrom(domains.value),
              contactMode,
              ...(flowOn && { answeringFlow: flow.value() }),
              ...(invitesOn && { whoCanInvite: inviters.value === 'members' ? 'members' : 'admins' }),
              features: features.value(),
            },
            {
              done: () => state.notice.set({ kind: 'info', text: strings.saved }),
              failed: (error) => problem.set(error.message),
            },
          )
        },
      },
    },
    field(strings.allowedDomains, domains, strings.allowedDomainsHint),
    invitesOn && field(strings.whoCanInvite, inviters),
    field(strings.contactMode, mode),
    flowOn && flow.section,
    features.section,
    save,
  )
}

/** One row per optional feature, with a switch and what people lose without it. */
const featureSwitchesEditor = (
  life: Lifetime,
  saved: Readonly<Record<string, boolean>>,
): { readonly section: HTMLElement; readonly value: () => Record<string, boolean> } => {
  const switches = signal<Readonly<Record<FeatureName, boolean>>>(featureSwitches(saved))
  const section = h(
    'fieldset',
    { class: 'features' },
    h('legend', {}, strings.features.title),
    h('p', {}, strings.features.intro),
    region(life, [switches], () =>
      h(
        'ol',
        { class: 'todo-list feature-list', 'aria-label': strings.features.title },
        featureRows(switches.get()).map((row) =>
          h(
            'li',
            { class: row.className, data: { name: row.name } },
            h(
              'button',
              {
                type: 'button',
                class: 'todo-switch',
                role: 'switch',
                'aria-checked': String(row.on),
                'aria-label': row.label,
                on: { click: () => switches.update((all) => ({ ...all, [row.name]: !row.on })) },
              },
              h('span', { class: 'todo-check', 'aria-hidden': 'true' }, row.check),
            ),
            h(
              'div',
              { class: 'todo-main' },
              h('strong', {}, row.label),
              h('small', { class: 'feature-loss' }, row.loss),
            ),
          ),
        ),
      ),
    ),
    h('p', { class: 'trust-footnote' }, strings.features.core),
  )
  return { section, value: () => ({ ...switches.get() }) }
}

/** The answering flow as two to-do lists: steps before drafting and checks on the draft, each switchable. */
const answeringFlowEditor = (
  life: Lifetime,
  saved: string | null,
  problem: Signal<string | null>,
): { readonly section: HTMLElement; readonly value: () => string | null } => {
  const steps = signal<ReadonlyArray<FlowStep>>(stepsFrom(saved))
  const keys = new WeakMap<FlowStep, string>()
  let next = 0
  const keyOf = (step: FlowStep): string => {
    if (!keys.has(step)) keys.set(step, `step-${next++}`)
    return keys.get(step)!
  }
  const stepWith = (key: string): FlowStep | undefined => steps.get().find((step) => keyOf(step) === key)
  const replace = (key: string, change: Partial<FlowStep>): void =>
    steps.update((all) => all.map((step) => (keyOf(step) === key ? { ...step, ...change } : step)))
  const list = (part: FlowStep['part']): HTMLElement => {
    const maxLength = flowToolsModel(steps.get()).maxCharacters
    return todoList({
      label: part === 'before' ? strings.answeringFlow.beforeTitle : strings.answeringFlow.checksTitle,
      rows: steps
        .get()
        .filter((step) => step.part === part)
        .map((step) => ({
          key: keyOf(step),
          name: step.text,
          enabled: step.enabled,
          fields: [
            { name: 'text', label: strings.answeringFlow.stepLabel, value: step.text, maxLength, wide: true },
          ],
        })),
      toggle: (key, enabled) => replace(key, { enabled }),
      edit: (key, _, text) => replace(key, { text }),
      move: (key, to) => {
        const step = stepWith(key)
        if (step !== undefined) steps.set(moveStep(steps.get(), step, to))
      },
      remove: (key) => steps.update((all) => all.filter((step) => keyOf(step) !== key)),
      add: {
        label: strings.answeringFlow.addStep,
        fields: [
          {
            name: 'text',
            label: strings.answeringFlow.stepLabel,
            value: '',
            maxLength,
            placeholder: strings.answeringFlow.stepPlaceholder,
            wide: true,
          },
        ],
        submit: (values, done) => {
          const text = values.text ?? ''
          if (text === '') return
          const added: FlowStep = { part, text, enabled: true }
          steps.set(moveStep([...steps.get(), added], added, Number.POSITIVE_INFINITY))
          done()
        },
      },
    })
  }
  const example = h('button', {
    type: 'button',
    class: 'insert-example',
    'aria-describedby': 'example-reason',
  })
  example.textContent = strings.answeringFlow.insertExample
  example.addEventListener('click', () => {
    if (!flowToolsModel(steps.get()).exampleDisabled) steps.set(stepsFrom(strings.answeringFlow.example))
  })
  const section = h(
    'fieldset',
    { class: 'answering-flow' },
    h('legend', {}, strings.answeringFlow.title),
    h('p', {}, strings.answeringFlow.intro),
    h(
      'div',
      { class: 'flow-warning', role: 'note' },
      h('p', {}, strings.answeringFlow.warning),
      h('p', {}, strings.answeringFlow.caution),
    ),
    region(life, [steps, problem], () => {
      const tools = flowToolsModel(steps.get())
      example.disabled = tools.exampleDisabled
      return [
        h('h3', { class: 'flow-list-title' }, strings.answeringFlow.beforeTitle),
        list('before'),
        h('h3', { class: 'flow-list-title' }, strings.answeringFlow.checksTitle),
        list('checks'),
        problem.get() !== null && h('p', { class: 'flow-problem', role: 'alert' }, problem.get()),
        h(
          'div',
          { class: 'flow-tools' },
          h('small', { class: tools.counterClass, 'aria-live': 'polite' }, tools.counter),
          h(
            'span',
            { class: 'disabled-control' },
            example,
            h(
              'small',
              { id: 'example-reason', hidden: tools.exampleDisabled === false },
              strings.answeringFlow.exampleNeedsEmpty,
            ),
          ),
        ),
      ]
    }),
  )
  return { section, value: () => flowToSave(steps.get()) }
}

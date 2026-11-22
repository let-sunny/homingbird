import { type AsRead, PRINCIPLE_TEXT_MAX, PRINCIPLE_TOPIC_MAX } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region } from '@homingbird/ui'
import {
  type ChannelTeachingModel,
  type CorrectionPrefill,
  channelTeachingModel,
  instructionToSave,
  instructionWarning,
} from '../models/channel-teaching.ts'
import { type ChannelPrincipleRow, addRowWarnings, reordered } from '../models/teaching.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { opensDialog } from './dialog.ts'
import { field, loading } from './parts.ts'
import { principleForm } from './principle-form.ts'
import { todoList } from './todo-list.ts'

/**
 * The Teach tab of a channel agent's page, for its managers: the instruction and sources, then the same
 * principle editor as My agent › Teaching, with each principle's figures.
 */
export const channelTeachingSection = (
  context: ViewContext,
  life: Lifetime,
  slug: string,
  agent: string,
): HTMLElement => {
  context.actions.loadChannelTeaching(slug)
  return region(
    life,
    [context.state.channelTeaching],
    () =>
      renderTeaching(
        channelTeachingModel(context.state.channelTeaching.get().get(slug) ?? 'loading', agent),
        context,
        slug,
        agent,
      ),
    { class: 'taught channel-teaching' },
  )
}

/** Opens the principle form for a channel's agent, prefilled from a manager's correction when there is one. */
export const teachChannelAgent = (
  context: ViewContext,
  slug: string,
  agent: string,
  prefill: CorrectionPrefill | null,
  label: string,
  className = 'primary teach-button',
): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: className,
      ...opensDialog(context, strings.channelTeach.dialogTitle({ agent }), () =>
        principleForm(context, null, null, false, { kind: 'channel', slug, agent, prefill }),
      ),
    },
    label,
  )

const renderTeaching = (
  model: ChannelTeachingModel,
  context: ViewContext,
  slug: string,
  agent: string,
): Child => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'failed') return h('p', { role: 'alert' }, model.text)
  return [
    h('p', { class: 'trust-footnote' }, model.intro),
    instructionForm(model.instruction, context, slug),
    h('h3', {}, model.principlesTitle),
    h(
      'div',
      { class: 'teach-actions' },
      teachChannelAgent(context, slug, agent, null, model.add),
      h('small', {}, model.limit),
    ),
    model.empty !== null &&
      h('div', { class: 'teach-empty' }, h('strong', {}, model.empty.title), h('p', {}, model.empty.hint)),
    principleList(model.principles, model.listLabel, context, slug, agent),
    h('p', { class: 'trust-footnote' }, model.footnotes[0]),
    h('p', { class: 'trust-footnote teach-audit' }, model.footnotes[1]),
  ]
}

const instructionForm = (
  model: Extract<ChannelTeachingModel, { kind: 'taught' }>['instruction'],
  context: ViewContext,
  slug: string,
): HTMLElement => {
  const instruction = h('textarea', {
    name: 'instruction',
    rows: '3',
    maxlength: String(model.maxLength),
    placeholder: model.placeholder,
  })
  instruction.value = model.value
  const sources = h('textarea', { name: 'sources', rows: '3', placeholder: 'https://' })
  sources.value = model.sources
  const warning = h('p', { class: 'advice is-forbidden', 'aria-live': 'polite' })
  const problem = h('p', { class: 'principle-problem', role: 'alert', hidden: true })
  const reflect = (): void => {
    const text = instructionWarning(instruction.value)
    warning.textContent = text ?? ''
    warning.hidden = text === null
  }
  instruction.addEventListener('input', reflect)
  reflect()
  return h(
    'form',
    {
      class: 'form channel-instruction',
      on: {
        submit: (event) => {
          event.preventDefault()
          const outcome = instructionToSave(instruction.value, sources.value)
          problem.textContent = 'problem' in outcome ? outcome.problem : ''
          problem.hidden = !('problem' in outcome)
          if ('problem' in outcome) return
          context.actions.saveChannelInstruction(slug, outcome.save.instruction, outcome.save.sources, {
            done: () =>
              context.state.notice.set({
                kind: 'info',
                text: strings.channelTeach.instructionSaved,
              }),
          })
        },
      },
    },
    h('h3', {}, model.title),
    field(model.label, instruction, model.hint),
    warning,
    field(model.sourcesLabel, sources, model.sourcesHint),
    problem,
    h('button', { type: 'submit' }, model.save),
  )
}

const principleList = (
  rows: ReadonlyArray<ChannelPrincipleRow>,
  label: string,
  context: ViewContext,
  slug: string,
  agent: string,
): HTMLElement => {
  const { actions, state } = context
  const ids = rows.map((row) => row.principle.id as string)
  return todoList({
    label,
    rows: rows.map((row) => ({
      key: row.principle.id,
      name: row.principle.topic,
      enabled: row.principle.enabled,
      fields: row.fields,
      details: h(
        'p',
        { class: 'principle-counts' },
        h('span', { class: 'principle-kind-badge' }, row.kindBadge),
        row.details.map((detail) => h('span', {}, detail)),
      ),
      problems: row.problems,
      menu: [detailsButton(context, slug, agent, row.principle)],
    })),
    toggle: (id, enabled) => actions.changeChannelPrinciple(slug, id, { enabled }),
    edit: (id, name, value) => actions.changeChannelPrinciple(slug, id, { [name]: value }),
    move: (id, to) => actions.reorderChannelPrinciples(slug, reordered(ids, id, to)),
    remove: (id) => {
      if (ids.includes(id)) actions.deleteChannelPrinciple(slug, id)
    },
    add: {
      label: strings.teach.addLabel,
      fields: [
        {
          name: 'topic',
          label: strings.teach.topic,
          value: '',
          maxLength: PRINCIPLE_TOPIC_MAX,
          placeholder: strings.teach.topicPlaceholder,
        },
        {
          name: 'rule',
          label: strings.teach.rule,
          value: '',
          maxLength: PRINCIPLE_TEXT_MAX,
          placeholder: strings.teach.rulePlaceholder,
          wide: true,
        },
      ],
      warnings: addRowWarnings,
      submit: (values, done) =>
        actions.saveChannelPrinciple(
          slug,
          { topic: values.topic ?? '', rule: values.rule ?? '', source: null },
          {
            done: () => {
              done()
              state.notice.set({ kind: 'info', text: strings.channelTeach.saved })
            },
          },
        ),
    },
  })
}

const detailsButton = (
  context: ViewContext,
  slug: string,
  agent: string,
  principle: AsRead.Principle,
): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: 'menu-item',
      ...opensDialog(context, strings.channelTeach.dialogTitle({ agent }), () =>
        principleForm(context, null, principle, false, { kind: 'channel', slug, agent, prefill: null }),
      ),
    },
    strings.teach.details,
  )

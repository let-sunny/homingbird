import {
  type AsRead,
  PRINCIPLE_TEXT_MAX,
  PRINCIPLE_TOPIC_MAX,
  PUBLIC_TEXT_MAX,
  type PrincipleKind,
} from '@homingbird/protocol'
import { type Child, h } from '@homingbird/ui'
import {
  type PrincipleFormState,
  type TeachSeed,
  principleFormModel,
  principleFormStart,
  principleToSave,
} from '../models/teaching.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog } from './dialog.ts'
import { button, field } from './parts.ts'
import { placeSelect } from './teaching.ts'

/** The guided form: what it is, a short title, how to answer, an optional source, warnings while typing. */
export const principleForm = (
  context: ViewContext,
  offer: AsRead.PrincipleOffer | null,
  editing: AsRead.Principle | null,
  showingPublic: boolean,
  seed: TeachSeed | null = null,
): Child => {
  const start = principleFormStart(offer, editing, showingPublic, seed)
  const kindChoice = (kind: PrincipleKind): HTMLInputElement =>
    h('input', { type: 'radio', name: 'kind', value: kind, checked: (editing?.kind ?? 'rule') === kind })
  const asRule = kindChoice('rule')
  const asAnswer = kindChoice('answer')
  const publicBox = h('input', { type: 'checkbox', name: 'public', checked: start.isPublic })
  const publicText = h('input', {
    name: 'publicText',
    maxlength: String(PUBLIC_TEXT_MAX),
    value: start.publicText,
  })
  const publicPart = h(
    'div',
    { class: 'principle-public' },
    field(strings.teach.publicLabel, publicText, strings.teach.publicHint),
    h('p', { class: 'flow-warning', role: 'note' }, strings.teach.publicWarning),
  )
  const topic = h('input', {
    name: 'topic',
    required: true,
    maxlength: String(PRINCIPLE_TOPIC_MAX),
    value: start.topic,
  })
  const rule = h('textarea', { name: 'rule', rows: '3', maxlength: String(PRINCIPLE_TEXT_MAX) })
  rule.value = start.rule
  const ruleLabel = h('span', { class: 'field-label' }, strings.teach.rule)
  const ruleHint = h('small', {}, strings.teach.ruleHint)
  const switchToAnswer = button(strings.teach.switchToAnswer, () => {
    asAnswer.checked = true
    reflect()
  })
  const problem = h('p', { class: 'principle-problem', role: 'alert', hidden: true })
  const source = h('input', { name: 'source', type: 'url', placeholder: 'https://', value: start.source })
  const host = h('small', { class: 'source-host', 'aria-live': 'polite' })
  const place = placeSelect(context, start.place === '' ? null : start.place, editing !== null)
  const advice = h('ul', { class: 'principle-advice', 'aria-live': 'polite' })
  const confirmBox = h('input', { type: 'checkbox', name: 'confirmed' })
  const confirm = h('label', { class: 'choice principle-confirm' }, confirmBox, strings.teach.confirm)
  const confirmHint = h('small', {}, strings.teach.confirmHint)
  const save = h('button', { type: 'submit', class: 'primary' }, strings.teach.save)
  const typed = (): PrincipleFormState => ({
    kind: asAnswer.checked ? 'answer' : 'rule',
    topic: topic.value,
    rule: rule.value,
    source: source.value,
    place: place.value,
    isPublic: publicBox.checked,
    publicText: publicText.value,
    confirmed: confirmBox.checked,
    offer,
  })
  const reflect = (): void => {
    const model = principleFormModel(typed())
    host.textContent = model.host
    ruleLabel.textContent = model.ruleLabel
    ruleHint.textContent = model.ruleHint
    rule.maxLength = model.ruleMaxLength
    rule.required = model.ruleRequired
    publicPart.hidden = !model.showsPublic
    publicText.required = model.showsPublic
    advice.replaceChildren(
      ...model.advice.map((each) =>
        h('li', { class: each.className }, each.text, each.offersAnswer && switchToAnswer),
      ),
    )
    confirm.hidden = !model.confirming
    confirmHint.hidden = !model.confirming
    save.disabled = model.saveDisabled
  }
  for (const control of [topic, rule, source, confirmBox]) control.addEventListener('input', reflect)
  for (const control of [confirmBox, asRule, asAnswer, publicBox]) control.addEventListener('change', reflect)
  reflect()
  const done = (): void => {
    closeDialog(context)
    context.state.notice.set({ kind: 'info', text: strings.teach.saved })
  }
  const submit = (): void => {
    const outcome = principleToSave(typed(), editing)
    problem.textContent = 'problem' in outcome ? outcome.problem : ''
    problem.hidden = !('problem' in outcome)
    if ('problem' in outcome) return
    const saving = outcome.save
    if (saving.kind === 'change') context.actions.changePrinciple(saving.id, saving.change, { done })
    else context.actions.savePrinciple(saving.input, { done })
  }
  return h(
    'form',
    {
      class: 'form principle-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          submit()
        },
      },
    },
    h(
      'fieldset',
      { class: 'principle-kind' },
      h('legend', {}, strings.teach.kindLabel),
      h('label', { class: 'choice' }, asRule, strings.teach.kinds.rule),
      h('label', { class: 'choice' }, asAnswer, strings.teach.kinds.answer),
    ),
    field(strings.teach.topic, topic, strings.teach.topicHint),
    h('label', { class: 'field' }, ruleLabel, rule, ruleHint),
    advice,
    field(strings.teach.source, source, strings.teach.sourceHint),
    host,
    field(strings.teach.place, place, strings.teach.placeHint),
    h('label', { class: 'choice' }, publicBox, strings.teach.publicToggle),
    publicPart,
    confirm,
    confirmHint,
    problem,
    save,
  )
}

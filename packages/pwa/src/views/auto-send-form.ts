import type { AsRead, ConversationId } from '@homingbird/protocol'
import { type Child, h } from '@homingbird/ui'
import { autoSendFormModel, autoSendPlaces, autoSendToSave } from '../models/auto-send.ts'
import { signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog } from './dialog.ts'

/** The switch that lets a saved answer send itself, and the places it may: only its person sets either. */
export const autoSendForm = (context: ViewContext, principle: AsRead.Principle): Child => {
  const { state } = context
  const me = signedIn(state)
  const model = autoSendFormModel(
    principle,
    me === null
      ? []
      : autoSendPlaces({
          conversations: state.conversations.get(),
          channels: state.channels.get(),
          members: state.members.get(),
          viewerId: me.member.id,
        }),
  )
  if (model === null) return null
  const enabled = h('input', { type: 'checkbox', name: 'autoSend', checked: model.enabled })
  const boxes = model.places.map((place) => ({
    id: place.id,
    box: h('input', { type: 'checkbox', name: 'place', value: place.id, checked: place.chosen }),
    label: place.label,
  }))
  const problem = h('p', { class: 'principle-problem', role: 'alert', hidden: true })
  const submit = (): void => {
    const chosen = boxes.filter((each) => each.box.checked).map((each) => each.id as ConversationId)
    const outcome = autoSendToSave(enabled.checked, chosen)
    problem.textContent = 'problem' in outcome ? outcome.problem : ''
    problem.hidden = !('problem' in outcome)
    if ('problem' in outcome) return
    context.actions.setAutoSend(principle.id, outcome.save, {
      done: () => {
        closeDialog(context)
        state.notice.set({
          kind: 'info',
          text: outcome.save.enabled ? strings.autoSend.saved : strings.autoSend.turnedOff,
        })
      },
    })
  }
  return h(
    'form',
    {
      class: 'form auto-send-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          submit()
        },
      },
    },
    h('label', { class: 'choice' }, enabled, model.switchLabel),
    h('p', { class: 'trust-footnote' }, model.hint),
    h(
      'fieldset',
      { class: 'auto-send-places' },
      h('legend', {}, model.placesLabel),
      h('small', {}, model.placesHint),
      model.noPlaces !== null && h('p', {}, model.noPlaces),
      boxes.map((each) => h('label', { class: 'choice' }, each.box, each.label)),
    ),
    problem,
    h('button', { type: 'submit', class: 'primary' }, model.save),
  )
}

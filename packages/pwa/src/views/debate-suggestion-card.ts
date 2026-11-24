import type { AsRead, MemberId } from '@homingbird/protocol'
import { type Lifetime, h, region, signal, slice } from '@homingbird/ui'
import {
  type SuggestionCard,
  suggestionAcceptance,
  suggestionCardModel,
} from '../models/debate-suggestion-card.ts'
import { chosenAmong, roomCandidates } from '../models/people-picker.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { button, field } from './parts.ts'
import { peoplePicker } from './people-picker.ts'

/**
 * A suggestion from the person's own agent to talk a note over first: why, the question and the colleagues
 * it would ask, all of which the person may change. Opening the flock leads to it; answering alone only
 * clears the card. Whose agents are awake is drawn by itself, so that presence never draws the fields again.
 */
export const debateSuggestionCard = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  card: SuggestionCard,
): HTMLElement => {
  const { state, actions } = context
  const id = card.suggestion.id
  const chosen = signal<ReadonlyArray<MemberId>>(card.people.chosen)
  const candidates = () =>
    roomCandidates(state.directory.get(), me.member.id, card.suggestion.askerId ?? null)
  const question = h('textarea', {
    name: 'question',
    rows: 2,
    maxLength: card.question.maxLength,
    value: card.question.value,
  })
  const brief = h('textarea', { name: 'brief', rows: 2, maxLength: card.brief.maxLength })
  const picker = peoplePicker(life, {
    id: `suggestion-${id}-people`,
    label: card.people.label,
    placeholder: card.people.placeholder,
    candidates,
    sources: [state.directory],
    chosen,
    limit: card.people.limit,
  })
  const presence = slice([state.directory], () => {
    const { notAwake, askInNote } = suggestionCardModel({
      suggestion: card.suggestion,
      members: state.members.get(),
      directory: state.directory.get(),
      viewerId: me.member.id,
    })
    return { notAwake, askInNote }
  })
  const problem = h('p', { class: 'advice', role: 'alert', hidden: true })
  const open = (): void => {
    const typed = suggestionAcceptance({
      question: question.value,
      memberIds: chosenAmong(candidates(), chosen.get(), card.people.limit),
      brief: brief.value,
    })
    if ('problem' in typed) {
      problem.textContent = typed.problem
      problem.hidden = false
      return
    }
    problem.hidden = true
    actions.acceptSuggestion(id, typed.acceptance, {
      done: (room) => context.page.go(hrefFor({ name: 'debate', id: room.id, tab: null })),
    })
  }
  return h(
    'li',
    { class: 'chance suggestion-card', role: 'note', data: { suggestion: id } },
    h('p', { class: 'suggestion-heading' }, h('strong', {}, card.heading)),
    h('p', { class: 'suggestion-reason' }, h('small', {}, card.reason.label), ' ', card.reason.text),
    field(card.question.label, question),
    picker.element,
    region(life, [presence], () => {
      const { notAwake } = presence.get()
      return notAwake !== null && h('p', { class: 'hint suggestion-not-awake' }, notAwake)
    }),
    field(card.brief.label, brief, card.brief.hint),
    h('p', { class: 'trust-footnote' }, card.limits),
    region(life, [presence], () => {
      const { askInNote } = presence.get()
      return (
        askInNote !== null &&
        h(
          'p',
          { class: 'advice suggestion-ask-in-note' },
          askInNote.text,
          ' ',
          h('a', { href: askInNote.href }, askInNote.label),
        )
      )
    }),
    problem,
    h(
      'div',
      { class: 'chance-actions' },
      button(card.labels.open, open, { class: 'primary' }),
      button(
        card.labels.dismiss,
        () =>
          actions.dismissSuggestion(id, {
            done: () => state.notice.set({ kind: 'info', text: strings.debateSuggestion.dismissed }),
          }),
        { class: 'link' },
      ),
    ),
  )
}

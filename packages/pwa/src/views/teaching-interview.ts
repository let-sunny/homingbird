import { type Child, type Lifetime, h, region, slice } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import {
  type InterviewModel,
  type ProposalCard,
  type ProposalGroup,
  idsOf,
  interviewModel,
  proposalChange,
} from '../models/teaching-interview.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { pageData } from './page-data.ts'
import { button, field, listWait } from './parts.ts'

/** "Teach by chatting" on the Teaching tab, shown while teaching is on. */
export const interviewSection = (context: ViewContext, life: Lifetime): HTMLElement | null => {
  if (!featureOn('teaching', context.state.serverInfo.get())) return null
  const { state, actions } = context
  actions.refreshInterview()
  const unsaved: Unsaved = new Map()
  const { shown, wait } = pageData(state, state.interview)
  return region(
    life,
    [shown, wait],
    () => renderInterview(interviewModel(shown.get(), wait.get()), context, unsaved),
    { class: 'teach-chat' },
  )
}

/** What the person typed and has not saved, by field, so that drawing the section again keeps it. */
type Unsaved = Map<string, string>

const keepTyped = (unsaved: Unsaved, key: string, input: TextInput, value: string): void => {
  input.value = unsaved.get(key) ?? value
  input.addEventListener('input', () => {
    if (input.value === value) unsaved.delete(key)
    else unsaved.set(key, input.value)
  })
}

type TextInput = HTMLInputElement | HTMLTextAreaElement

const renderInterview = (model: InterviewModel, context: ViewContext, unsaved: Unsaved): Child => {
  if (model.kind === 'waiting') return listWait(model.wait, () => context.actions.askAgain('interview'))
  const document = h('textarea', {
    name: 'document',
    rows: 4,
    maxLength: model.document.maxLength,
  })
  keepTyped(unsaved, 'document', document, model.document.value)
  const notify = (text: string) => () => context.state.notice.set({ kind: 'info', text })
  return [
    h('h3', { id: 'teach-chat' }, model.title),
    h('p', { class: 'trust-footnote' }, model.intro),
    h(
      'ol',
      { class: 'teach-chat-steps' },
      model.steps.map((step) => h('li', {}, step)),
    ),
    h('p', { class: 'trust-footnote' }, model.noModel),
    h(
      'div',
      { class: 'teach-chat-document' },
      field(model.document.label, document, model.document.hint),
      h(
        'div',
        { class: 'chance-actions' },
        button(model.document.save, () => {
          const saved = document.value
          context.actions.saveTeachingDocument(saved.trim() === '' ? null : saved, {
            done: () => {
              if (unsaved.get('document') === saved) unsaved.delete('document')
              notify(strings.teach.chat.documentSaved)()
            },
          })
        }),
        model.document.remove !== null &&
          button(
            model.document.remove,
            () => {
              unsaved.delete('document')
              context.actions.saveTeachingDocument(null, {
                done: notify(strings.teach.chat.documentRemoved),
              })
            },
            { class: 'link' },
          ),
      ),
    ),
    model.empty !== null && h('p', { class: 'teach-empty' }, model.empty),
    model.groups.map((each) => proposalGroup(each, context, unsaved)),
    h('small', {}, model.waiting),
  ]
}

const proposalGroup = (shown: ProposalGroup, context: ViewContext, unsaved: Unsaved): HTMLElement =>
  h(
    'section',
    { class: 'proposal-group', data: { group: shown.key }, 'aria-labelledby': `proposals-${shown.key}` },
    h('h4', { id: `proposals-${shown.key}` }, shown.title),
    shown.intro !== null && h('p', { class: 'trust-footnote' }, shown.intro),
    h(
      'ul',
      { class: 'chance-list' },
      shown.cards.map((card) => h('li', {}, proposalCard(card, context, unsaved))),
    ),
    button(
      shown.saveAll,
      () =>
        context.actions.acceptProposals(idsOf(shown.cards), {
          done: () =>
            context.state.notice.set({
              kind: 'info',
              text: strings.teach.chat.savedAll({ count: shown.cards.length }),
            }),
        }),
      { class: 'primary save-all' },
    ),
  )

const proposalCard = (card: ProposalCard, context: ViewContext, unsaved: Unsaved): HTMLElement => {
  const id = card.proposal.id
  const inputs = card.fields.map((each) => {
    const input =
      each.name === 'topic'
        ? h('input', { name: each.name, maxLength: each.maxLength })
        : h('textarea', { name: each.name, maxLength: each.maxLength, rows: 2 })
    keepTyped(unsaved, `${id} ${each.name}`, input, each.value)
    return input
  })
  const isEdited = card.fields.some((each) => unsaved.has(`${id} ${each.name}`))
  const problem = h('p', { class: 'advice', role: 'alert', hidden: true })
  const saved = () => context.state.notice.set({ kind: 'info', text: strings.teach.chat.saved })
  const saveEdited = () => {
    const chosen = proposalChange(card, {
      topic: (inputs[0] as HTMLInputElement).value,
      rule: (inputs[1] as HTMLTextAreaElement).value,
    })
    if ('problem' in chosen) {
      problem.textContent = chosen.problem
      problem.hidden = false
      return
    }
    context.actions.acceptProposal(id, chosen.change, { done: saved })
  }
  return h(
    'div',
    { class: 'chance proposal', role: 'note', data: { proposal: id } },
    h(
      'p',
      {},
      h('span', { class: 'principle-kind-badge' }, card.kindBadge),
      ' ',
      h('strong', {}, card.proposal.topic),
    ),
    h('p', {}, card.proposal.rule),
    h(
      'p',
      { class: 'principle-counts' },
      card.details.map((detail) => h('span', {}, detail)),
    ),
    card.warnings.map((warning) => h('p', { class: 'advice' }, warning)),
    h(
      'div',
      { class: 'chance-actions' },
      button(card.labels.save, () => context.actions.acceptProposal(id, {}, { done: saved }), {
        class: 'primary',
      }),
      button(
        card.labels.discard,
        () =>
          context.actions.discardProposal(id, {
            done: () => context.state.notice.set({ kind: 'info', text: strings.teach.chat.discarded }),
          }),
        { class: 'link' },
      ),
    ),
    h(
      'details',
      { class: 'proposal-edit', open: isEdited },
      h('summary', {}, card.labels.edit),
      card.fields.map((each, index) => field(each.label, inputs[index]!)),
      problem,
      button(card.labels.saveEdited, saveEdited),
    ),
  )
}

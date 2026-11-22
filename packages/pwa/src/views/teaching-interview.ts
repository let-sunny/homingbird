import { type Child, type Lifetime, h, region } from '@homingbird/ui'
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
import { button, field, loading } from './parts.ts'

/** "Teach by chatting" on the Teaching tab, shown while teaching is on. */
export const interviewSection = (context: ViewContext, life: Lifetime): HTMLElement | null => {
  if (!featureOn('teaching', context.state.serverInfo.get())) return null
  context.actions.refreshInterview()
  return region(
    life,
    [context.state.interview],
    () => renderInterview(interviewModel(context.state.interview.get()), context),
    { class: 'teach-chat' },
  )
}

const renderInterview = (model: InterviewModel, context: ViewContext): Child => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'failed') return h('p', { role: 'alert' }, model.text)
  const document = h('textarea', {
    name: 'document',
    rows: 4,
    maxLength: model.document.maxLength,
    value: model.document.value,
  })
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
        button(model.document.save, () =>
          context.actions.saveTeachingDocument(document.value.trim() === '' ? null : document.value, {
            done: notify(strings.teach.chat.documentSaved),
          }),
        ),
        model.document.remove !== null &&
          button(
            model.document.remove,
            () =>
              context.actions.saveTeachingDocument(null, {
                done: notify(strings.teach.chat.documentRemoved),
              }),
            { class: 'link' },
          ),
      ),
    ),
    model.empty !== null && h('p', { class: 'teach-empty' }, model.empty),
    model.groups.map((each) => proposalGroup(each, context)),
    h('small', {}, model.waiting),
  ]
}

const proposalGroup = (shown: ProposalGroup, context: ViewContext): HTMLElement =>
  h(
    'section',
    { class: 'proposal-group', data: { group: shown.key }, 'aria-labelledby': `proposals-${shown.key}` },
    h('h4', { id: `proposals-${shown.key}` }, shown.title),
    shown.intro !== null && h('p', { class: 'trust-footnote' }, shown.intro),
    h(
      'ul',
      { class: 'chance-list' },
      shown.cards.map((card) => h('li', {}, proposalCard(card, context))),
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

const proposalCard = (card: ProposalCard, context: ViewContext): HTMLElement => {
  const id = card.proposal.id
  const inputs = card.fields.map((each) =>
    each.name === 'topic'
      ? h('input', { name: each.name, value: each.value, maxLength: each.maxLength })
      : h('textarea', { name: each.name, value: each.value, maxLength: each.maxLength, rows: 2 }),
  )
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
      { class: 'proposal-edit' },
      h('summary', {}, card.labels.edit),
      card.fields.map((each, index) => field(each.label, inputs[index]!)),
      problem,
      button(card.labels.saveEdited, saveEdited),
    ),
  )
}

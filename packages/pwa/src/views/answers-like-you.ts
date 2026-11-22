import { type Child, type Lifetime, h, region } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import {
  type Action,
  type AnswersLikeYou,
  type PlaceRow,
  type StepWords,
  type Track,
  answersLikeYouModel,
} from '../models/answers-like-you.ts'
import type { ViewContext } from './context.ts'
import { timeLabel } from './parts.ts'
import { teachFromMiss } from './teaching.ts'

/** "Where it answers like you", from the 30-day report and what the person taught, each redrawn as it arrives. */
export const answersLikeYouSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const teaching = featureOn('teaching', context.state.serverInfo.get())
  if (teaching) context.actions.refreshPrinciples()
  return region(
    life,
    [context.state.agentReport, context.state.taught],
    () =>
      renderAnswersLikeYou(
        answersLikeYouModel(context.state.agentReport.get(), context.state.taught.get(), teaching),
        context,
      ),
    { class: 'answers-like-you' },
  )
}

const placeRow = (row: PlaceRow, context: ViewContext): HTMLElement =>
  h(
    'li',
    { class: `answers-place${row.slipped ? ' is-slipped' : ''}`, data: { place: row.key } },
    h(
      'div',
      { class: 'answers-place-inner' },
      h(
        'div',
        { class: 'answers-place-head' },
        h('strong', { class: 'answers-place-name' }, row.name),
        h('span', { class: 'answers-place-count' }, row.count),
      ),
      h(
        'div',
        { class: 'answers-place-body' },
        row.track !== null && track(row.track),
        h('p', { class: 'answers-sentence' }, row.sentence),
      ),
      row.action !== null && h('div', { class: 'answers-action' }, action(row.action, context)),
    ),
  )

const track = (model: Track): Child => [
  h(
    'ol',
    { class: 'answers-track', 'aria-label': model.label },
    model.steps.map((step) =>
      h(
        'li',
        {
          class: `answers-step${step.reached ? ' is-reached' : ''}${step.last ? ' is-last' : ''}`,
          tabindex: '0',
          'aria-current': step.current && 'step',
          'aria-describedby': step.id,
        },
        h('span', { class: 'answers-step-bar', 'aria-hidden': 'true' }),
        h('span', { class: 'answers-step-name' }, step.name),
        tooltip(step),
      ),
    ),
  ),
  h('p', { class: 'answers-step-now', 'aria-hidden': 'true' }, model.now),
]

const tooltip = (step: StepWords & { readonly id: string }): HTMLElement =>
  h(
    'span',
    { class: 'answers-step-tip', role: 'tooltip', id: step.id },
    h('strong', { class: 'answers-step-title' }, step.name),
    h('span', {}, step.meaning),
    h('span', {}, step.toReach),
  )

const action = (model: Action, context: ViewContext): HTMLElement => {
  switch (model.kind) {
    case 'chances':
      return h('a', { class: 'button answers-teach', href: model.href }, model.label)
    case 'teach':
      return teachFromMiss(context, model.label, model.seed, 'answers-teach')
    case 'skipped':
      return h(
        'details',
        { class: 'answers-skipped' },
        h('summary', {}, model.label),
        h(
          'ul',
          { class: 'drafts-behind-list' },
          model.notes.map((note) =>
            h(
              'li',
              { class: 'drafts-behind-row', data: { key: note.key } },
              timeLabel(note.time),
              h('a', { href: note.href }, note.open),
            ),
          ),
        ),
      )
  }
}

/** Each place as a row: its name and count, its track with a tooltip per step, one sentence and the next action. */
const renderAnswersLikeYou = (model: AnswersLikeYou | null, context: ViewContext): Child =>
  model === null
    ? null
    : h(
        'section',
        { class: 'trust-section', 'aria-labelledby': 'answers-like-you' },
        h('h3', { id: 'answers-like-you' }, model.title),
        h('p', { class: 'trust-footnote' }, model.intro),
        h(
          'ul',
          { class: 'answers-places' },
          model.rows.map((row) => placeRow(row, context)),
        ),
        model.steps !== null &&
          h(
            'details',
            { class: 'answers-steps' },
            h('summary', {}, model.steps.title),
            h(
              'ol',
              {},
              model.steps.items.map((step) =>
                h(
                  'li',
                  step.last ? { class: 'is-last' } : {},
                  h('strong', { class: 'answers-step-title' }, step.name),
                  h('span', {}, step.meaning),
                  h('span', {}, step.toReach),
                ),
              ),
            ),
          ),
        model.steps !== null && h('p', { class: 'trust-footnote' }, model.footnote),
      )

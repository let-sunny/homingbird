import { type Child, h } from '@homingbird/ui'
import type { ResultBody, ResultModel } from '../models/debate-result.ts'
import { strings } from '../strings.ts'

/** The room's result: waiting with its deadlines, or settled with who drafted it and its words. */
export const resultSection = (result: ResultModel): HTMLElement => {
  if (result.kind === 'waiting')
    return section(
      strings.debates.resultTitle,
      'debate-result',
      result.text !== null && h('p', {}, result.text),
      result.collecting !== null && h('p', { class: 'debate-collecting' }, result.collecting),
      result.voting !== null && h('p', { class: 'debate-voting' }, result.voting),
    )
  return section(
    strings.debates.resultTitle,
    'debate-result',
    h('p', { class: 'hint' }, result.draftedBy),
    ...renderResultBody(result.body, { contributions: false }),
  )
}

/** How each agent voted on the drafts, with the model it stated beside its vote. */
export const renderVoteRecord = (
  voteRecord: NonNullable<Extract<ResultModel, { kind: 'settled' }>['voteRecord']>,
): HTMLElement =>
  h(
    'div',
    { class: 'debate-vote-record' },
    voteRecord.none !== null
      ? h('p', { class: 'hint' }, voteRecord.none)
      : h(
          'ul',
          {},
          voteRecord.lines.map((line) =>
            h(
              'li',
              { class: `is-${line.kind}`, data: { member: line.memberId } },
              line.text,
              line.model !== null && h('small', { class: 'debate-vote-model' }, line.model),
            ),
          ),
        ),
  )

/** A result's words, as headed lists; a settled result's contributions are shown with the room's stats. */
export const renderResultBody = (body: ResultBody, shows: { readonly contributions: boolean }): Child[] => {
  if (body.kind === 'unknown') return [h('p', { class: 'hint' }, body.text)]
  return [
    h('h3', {}, body.heading),
    h('p', { class: 'debate-conclusion' }, body.summary),
    h('h4', {}, body.listHeading),
    body.reasons !== null
      ? h(
          'ul',
          {},
          body.reasons.map((reason) => h('li', {}, reason)),
        )
      : h(
          'ul',
          { class: 'debate-points' },
          (body.points ?? []).map((point) =>
            h(
              'li',
              { class: 'debate-point', data: { category: point.category } },
              h('strong', {}, point.point),
              h('span', { class: 'debate-category' }, point.categoryText),
              h('p', {}, point.explanation),
            ),
          ),
        ),
    h('h4', {}, body.nextSteps.heading),
    body.nextSteps.none !== null
      ? h('p', {}, body.nextSteps.none)
      : h(
          'ul',
          { class: 'debate-next-steps' },
          body.nextSteps.steps.map((step) =>
            h(
              'li',
              {},
              h('span', {}, step.step),
              step.owner !== null && h('small', {}, step.owner),
              h('small', {}, step.proposedBy),
            ),
          ),
        ),
    shows.contributions && h('h4', {}, body.contributions.heading),
    shows.contributions && renderContributions(body.contributions),
  ]
}

/** One headed section of a room's page. */
export const section = (title: string, className: string, ...children: ReadonlyArray<Child>): HTMLElement =>
  h('section', { class: `debate-section ${className}` }, h('h2', {}, title), ...children)

/** What each agent contributed to a result, with each credit's meaning on request. */
const renderContributions = (contributions: KnownBody['contributions']): HTMLElement =>
  h(
    'ul',
    { class: 'debate-contributions' },
    contributions.rows.map((row) =>
      h(
        'li',
        {},
        h('strong', {}, row.name),
        h('span', {}, row.summary),
        ...row.credits.map((credit) =>
          h('span', { class: 'debate-credit', title: credit.hint }, credit.text),
        ),
      ),
    ),
  )

type KnownBody = Extract<ResultBody, { kind: 'known' }>

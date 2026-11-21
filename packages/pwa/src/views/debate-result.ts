import { type Child, h, linkedText } from '@homingbird/ui'
import type { CitedText, ResultBody, ResultModel } from '../models/debate-result.ts'
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

/** The votes each draft got and how a tie was settled, then how each agent voted, with the model it stated. */
export const renderVoteRecord = (
  voteRecord: NonNullable<Extract<ResultModel, { kind: 'settled' }>['voteRecord']>,
): HTMLElement =>
  h(
    'div',
    { class: 'debate-vote-record' },
    voteRecord.tally.length > 0 &&
      h(
        'section',
        { class: 'debate-tally', 'aria-label': strings.debates.tallyTitle },
        h('h3', {}, strings.debates.tallyTitle),
        h(
          'ul',
          {},
          voteRecord.tally.map((line) =>
            h(
              'li',
              { class: line.chosen ? 'is-chosen' : '', data: { member: line.memberId } },
              h('span', {}, line.draft),
              h('strong', { class: 'debate-tally-votes' }, line.votes),
              line.chosen && h('span', { class: 'debate-draft-chosen' }, strings.debates.chosen),
            ),
          ),
        ),
        voteRecord.tie !== null && h('p', { class: 'debate-tie' }, voteRecord.tie),
      ),
    voteRecord.none !== null
      ? h('p', { class: 'hint' }, voteRecord.none)
      : h(
          'ul',
          {},
          voteRecord.lines.map((line) =>
            h(
              'li',
              { class: `is-${line.kind}`, data: { member: line.memberId } },
              h('span', {}, line.text),
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
    h('p', { class: 'debate-conclusion' }, citedText(body.summary)),
    h('h4', {}, body.listHeading),
    body.reasons !== null
      ? h(
          'ul',
          { class: 'debate-reasons' },
          body.reasons.map((reason) => h('li', {}, citedText(reason))),
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
              h('p', {}, citedText(point.explanation)),
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
              h('span', {}, citedText(step.step)),
              step.owner !== null && h('small', {}, step.owner),
              h('small', {}, step.proposedBy),
            ),
          ),
        ),
    shows.contributions && h('h4', {}, body.contributions.heading),
    shows.contributions && renderContributions(body.contributions),
  ]
}

/** Words with the turns they cite as links to those turns, and web addresses as links. */
export const citedText = (parts: CitedText): Child[] =>
  parts.flatMap((part) =>
    part.kind === 'turn'
      ? [h('a', { class: 'turn-cite', href: part.href }, part.text)]
      : linkedText(part.text),
  )

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
        h('span', {}, citedText(row.summary)),
        ...row.credits.map((credit) =>
          h('span', { class: 'debate-credit', title: credit.hint }, credit.text),
        ),
      ),
    ),
  )

type KnownBody = Extract<ResultBody, { kind: 'known' }>

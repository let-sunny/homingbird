import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, derived, h, region, slice } from '@homingbird/ui'
import { channelLabel } from '../channels.ts'
import {
  type ChannelDecisionsModel,
  type DecisionRow,
  channelDecisionsModel,
} from '../models/channel-decisions.ts'
import { teachChannelAgent } from './channel-teaching.ts'
import type { ViewContext } from './context.ts'
import { noteBody } from './note-body.ts'
import { readPageData } from './page-data.ts'
import { listWait, timeLabel } from './parts.ts'

/**
 * Recent decisions on a channel agent's answers, on its page for its managers: read again whenever an
 * answer in the channel is sent or discarded, each row with a way to teach the agent from it.
 */
export const channelDecisionsSection = (
  context: ViewContext,
  life: Lifetime,
  channel: AsRead.Channel,
): HTMLElement => {
  const { state, actions } = context
  const held = state.channelDecisions.use(channel.slug, life)
  const { shown, wait } = readPageData(state, held)
  const people = slice([state.members], () => state.members.get())
  const waitingHere = derived([state.reviews], (reviews) =>
    reviews
      .filter((review) => review.channel === channel.slug)
      .map((review) => review.note.id)
      .join(' '),
  )
  actions.openAgentPage('channelDecisions', channel.slug)
  life.add(waitingHere.subscribe(() => actions.reloadAgentPage('channelDecisions', channel.slug)))
  const agent = channel.agent?.name ?? channelLabel(channel.slug)
  return region(
    life,
    [shown, wait, people, state.serverInfo],
    () =>
      renderDecisions(
        channelDecisionsModel(shown.get(), wait.get(), {
          agent,
          members: people.get(),
          serverInfo: state.serverInfo.get(),
          now: context.clock.now(),
        }),
        context,
        channel.slug,
        agent,
      ),
    { class: 'channel-decisions-region' },
  )
}

const renderDecisions = (
  model: ChannelDecisionsModel,
  context: ViewContext,
  slug: string,
  agent: string,
): Child => {
  if (model.kind === 'hidden') return null
  if (model.kind === 'waiting')
    return listWait(model.wait, () => context.actions.askAgentPageAgain('channelDecisions', slug))
  return h(
    'section',
    { class: 'channel-decisions' },
    h('h3', {}, model.title),
    h('p', { class: 'hint' }, model.intro),
    model.none !== null && h('p', { class: 'hint' }, model.none),
    model.rows.length > 0 &&
      h(
        'ul',
        { class: 'decision-rows', 'aria-label': model.listLabel },
        model.rows.map((row) => decisionRow(row, context, slug, agent)),
      ),
  )
}

const decisionRow = (row: DecisionRow, context: ViewContext, slug: string, agent: string): HTMLElement =>
  h(
    'li',
    { class: `decision-row is-${row.outcome}`, data: { note: row.key } },
    h(
      'p',
      { class: 'decision-head' },
      h('strong', { class: 'decision-outcome' }, row.label),
      h('span', {}, row.decidedBy),
      timeLabel(row.time),
      row.privately !== null && h('span', { class: 'review-private' }, row.privately),
    ),
    row.question !== null &&
      h(
        'blockquote',
        { class: 'review-question' },
        h('small', {}, row.question.from),
        h('p', {}, row.question.body),
      ),
    row.original !== null && labelled(context, row.original, 'decision-original'),
    labelled(context, row.answer, 'decision-answer'),
    row.reason !== null &&
      h('p', { class: 'decision-reason' }, h('small', {}, row.reason.label), h('span', {}, row.reason.body)),
    row.principles !== null && h('p', { class: 'hint decision-principles' }, row.principles),
    h(
      'p',
      { class: 'decision-actions' },
      h('a', { href: row.open.href }, row.open.label),
      row.teach !== null &&
        teachChannelAgent(context, slug, agent, row.teach.prefill, row.teach.label, 'teach-button'),
    ),
  )

const labelled = (
  context: ViewContext,
  text: { readonly label: string; readonly body: string },
  className: string,
): HTMLElement => h('div', { class: className }, h('small', {}, text.label), noteBody(context, text.body))

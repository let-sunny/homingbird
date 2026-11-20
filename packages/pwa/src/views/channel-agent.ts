import type { AsRead } from '@homingbird/protocol'
import { CHANNEL_AGENT_NAME_MAX } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import {
  type AgentPanel,
  type ReviewCard,
  agentControlsModel,
  agentPanelModel,
  reviewCardsModel,
} from '../models/channel-agent.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, opensDialog } from './dialog.ts'
import { button, dialogActions, field, loading } from './parts.ts'

/** The agent's buttons among a channel's own controls: its panel for a manager, and asking it privately. */
export const agentButtons = (
  context: ViewContext,
  channel: AsRead.Channel,
  viewerIsManager: boolean,
): Child => {
  const model = agentControlsModel(channel, context.state.serverInfo.get(), viewerIsManager)
  return [
    model.manage !== null &&
      h(
        'button',
        {
          type: 'button',
          class: 'channel-agent-open',
          ...opensDialog(context, model.manage, (life) => agentPanel(context, life, channel)),
        },
        model.manage,
      ),
    model.askPrivately !== null &&
      button(model.askPrivately, () => context.actions.askPrivately(channel.slug), {
        class: 'ask-privately',
      }),
  ]
}

const agentPanel = (context: ViewContext, life: Lifetime, channel: AsRead.Channel): HTMLElement => {
  const { state, actions } = context
  const loaded = signal(false)
  actions.loadChannelAgent(channel.slug, { done: () => loaded.set(true) })
  actions.loadReviews()
  return h(
    'div',
    { class: 'dialog-body channel-agent-panel' },
    region(life, [loaded, state.channelAgents, state.members], () =>
      renderPanel(
        agentPanelModel(
          loaded.get() ? (state.channelAgents.get().get(channel.slug) ?? null) : 'loading',
          state.members.get(),
        ),
        context,
        channel,
      ),
    ),
    region(life, [state.reviews, state.reviewsRead, state.members], () => {
      const model = reviewCardsModel(
        state.reviews.get(),
        channel.slug,
        state.reviewsRead.get(),
        state.members.get(),
      )
      return h(
        'section',
        { class: 'reviews' },
        h('h3', {}, model.title),
        model.none !== null && h('p', { class: 'hint' }, model.none),
        h(
          'ul',
          { class: 'review-cards' },
          model.cards.map((card) => reviewCard(context, card)),
        ),
      )
    }),
  )
}

const renderPanel = (model: AgentPanel, context: ViewContext, channel: AsRead.Channel): Child => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'none')
    return [
      h('p', {}, model.intro),
      h('p', { class: 'hint' }, model.text),
      nameForm(model.create, '', (name) => context.actions.createChannelAgent(channel.slug, name)),
    ]
  return [
    h('p', {}, model.intro),
    nameForm(strings.channelAgent.rename, model.name, (name) =>
      context.actions.renameChannelAgent(channel.slug, name),
    ),
    h('h3', {}, model.desksTitle),
    model.desksNone !== null && h('p', { class: 'hint' }, model.desksNone),
    h(
      'ul',
      { class: 'agent-desks' },
      model.desks.map((desk) =>
        h(
          'li',
          { class: 'agent-desk', data: { credential: desk.id } },
          h('span', { class: 'agent-desk-name' }, desk.name),
          desk.issuedBy !== null && h('small', {}, desk.issuedBy),
          desk.state !== null && h('small', { class: 'agent-desk-state' }, desk.state),
          desk.disconnect !== null &&
            button(desk.disconnect, () => context.actions.disconnectAgentDesk(channel.slug, desk.id), {
              class: 'danger',
            }),
        ),
      ),
    ),
    h('p', { class: 'hint' }, model.connectHint),
    h(
      'form',
      {
        class: 'retire-agent',
        on: {
          submit: (event) => {
            event.preventDefault()
            context.actions.retireChannelAgent(channel.slug, { done: () => closeDialog(context) })
          },
        },
      },
      h('h3', {}, model.retireTitle),
      h('p', {}, model.retireBody),
      dialogActions(strings.channelAgent.retire, 'danger'),
    ),
  ]
}

const nameForm = (label: string, value: string, save: (name: string) => void): HTMLElement => {
  const name = h('input', {
    name: 'name',
    required: true,
    maxlength: String(CHANNEL_AGENT_NAME_MAX),
    autocomplete: 'off',
    value,
  })
  return h(
    'form',
    {
      class: 'form agent-name',
      on: {
        submit: (event) => {
          event.preventDefault()
          const typed = name.value.trim()
          if (typed !== '') save(typed)
        },
      },
    },
    field(strings.channelAgent.nameLabel, name, strings.channelAgent.nameHint),
    h('button', { type: 'submit', class: 'primary' }, label),
  )
}

const reviewCard = (context: ViewContext, card: ReviewCard): HTMLElement =>
  h(
    'li',
    { class: 'review-card', data: { note: card.review.note.id } },
    card.privately !== null && h('span', { class: 'review-private' }, card.privately),
    card.question !== null &&
      h(
        'blockquote',
        { class: 'review-question' },
        h('small', {}, card.question.from),
        h('p', {}, card.question.body),
      ),
    h('p', { class: 'review-body' }, card.body),
    card.basis !== null &&
      h(
        'div',
        { class: 'review-basis' },
        h('small', {}, card.basis.title),
        h(
          'ul',
          {},
          card.basis.lines.map((line) => h('li', {}, line)),
        ),
      ),
    card.readAgain !== null
      ? h(
          'div',
          { class: 'read-again', role: 'status' },
          h('p', {}, card.readAgain.notice),
          button(card.readAgain.confirm, () => context.actions.confirmReviewRead(card.review)),
        )
      : h(
          'div',
          { class: 'review-actions' },
          button(card.discard, () => context.actions.discardReview(card.review), { class: 'danger' }),
          button(card.send, () => context.actions.sendReview(card.review, null, { attempt: 'draft' }), {
            class: 'primary',
          }),
        ),
  )

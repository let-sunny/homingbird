import type { AsRead, NoteId } from '@homingbird/protocol'
import { CHANNEL_AGENT_NAME_MAX } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import {
  type ChannelAgentFiguresModel,
  type ChannelAgentFiguresState,
  channelAgentFiguresModel,
} from '../models/channel-agent-figures.ts'
import {
  type AgentPanel,
  type ReviewCard,
  agentControlsModel,
  agentPanelModel,
  channelAgentPageModel,
  decidedAnswerModel,
  reviewCardsModel,
  reviewsWaitingModel,
} from '../models/channel-agent.ts'
import { signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, opensDialog } from './dialog.ts'
import { reportWhenSeen } from './drafts-item.ts'
import { joinCodeSection } from './join-code.ts'
import { button, field, loading, page as pageOf } from './parts.ts'

/** The agent's buttons among a channel's own controls: its panel for a manager, and asking it privately. */
export const agentButtons = (context: ViewContext, channel: AsRead.Channel): Child => {
  const model = agentControlsModel(channel, context.state.serverInfo.get())
  return [
    model.manage !== null &&
      h(
        'button',
        {
          type: 'button',
          class: 'channel-agent-open',
          ...opensDialog(context, model.manage, (life) => agentPanel(context, life, channel, null)),
        },
        model.manage,
      ),
    model.askPrivately !== null &&
      button(model.askPrivately, () => context.actions.askPrivately(channel.slug), {
        class: 'ask-privately',
      }),
  ]
}

/** Beside the conversations: how many answers wait for the person to review, and where. */
export const reviewsWaiting = (context: ViewContext, life: Lifetime): HTMLElement =>
  region(
    life,
    [context.state.reviews],
    () => {
      const model = reviewsWaitingModel(context.state.reviews.get())
      return (
        model !== null &&
        h(
          'div',
          { class: 'reviews-waiting', role: 'status' },
          h('p', {}, model.text),
          model.links.map((link) => h('a', { class: 'button', href: link.href }, link.label)),
        )
      )
    },
    { class: 'reviews-waiting-host' },
  )

/**
 * The page of a channel's agent, where a desk connected as it sends its managers to review its answers,
 * and a review notification opens one answer's card.
 */
export const channelAgentView = (
  context: ViewContext,
  life: Lifetime,
  slug: string,
  focus: string | null,
): HTMLElement => {
  const { state, actions } = context
  actions.loadKnownChannels()
  return h(
    'div',
    { class: 'channel-agent-page' },
    region(life, [state.channels, state.channelsLoaded], () => {
      const page = channelAgentPageModel(state.channels.get(), state.channelsLoaded.get(), slug)
      if (page.kind === 'loading') return loading()
      if (page.kind === 'missing') return h('p', { class: 'hint' }, page.text)
      return pageOf(page.title, agentPanel(context, life, page.channel, focus))
    }),
  )
}

/** The agent of a channel the person manages, its desks and the answers waiting: in a dialog or on its own page. */
const agentPanel = (
  context: ViewContext,
  life: Lifetime,
  channel: AsRead.Channel,
  focus: string | null,
): HTMLElement => {
  const { state, actions } = context
  const loaded = signal<'loading' | 'loaded' | 'failed'>('loading')
  const decided = signal<{ readonly note: AsRead.Note | null } | null>(null)
  let broughtIntoView = false
  let askedWhatBecameOfFocus = false
  const learnWhatBecameOfFocus = (): void => {
    const isWaiting = state.reviews.get().some((review) => review.note.id === focus)
    if (focus === null || isWaiting || askedWhatBecameOfFocus) return
    askedWhatBecameOfFocus = true
    actions.loadDecidedAnswer(focus as NoteId, { done: (note) => decided.set({ note }) })
  }
  let joinSection: { readonly name: string; readonly element: HTMLElement } | null = null
  const joinCodeFor = (name: string): HTMLElement | null => {
    if (!featureOn('joinCodes', state.serverInfo.get())) return null
    if (joinSection?.name !== name)
      joinSection = { name, element: joinCodeSection(context, life, { channel: channel.slug, name }) }
    return joinSection.element
  }
  actions.loadChannelAgent(channel.slug, {
    done: () => loaded.set('loaded'),
    failed: () => loaded.set('failed'),
  })
  actions.loadReviews({
    done: () => {
      learnWhatBecameOfFocus()
      life.add(state.reviews.subscribe(learnWhatBecameOfFocus))
    },
  })
  const figures = signal<ChannelAgentFiguresState>('loading')
  const loadFigures = (): void =>
    actions.loadChannelAgentFigures(channel.slug, {
      done: (report) => figures.set(report),
      failed: () => figures.set('failed'),
    })
  loadFigures()
  life.add(state.reviews.subscribe(loadFigures))
  const panel = h(
    'div',
    { class: 'dialog-body channel-agent-panel' },
    region(life, [loaded, state.channelAgents, state.members], () =>
      renderPanel(
        agentPanelModel(
          agentState(loaded.get(), state.channelAgents.get(), channel.slug),
          state.members.get(),
        ),
        context,
        channel,
        joinCodeFor,
      ),
    ),
    region(life, [state.reviews, state.reviewsRead, state.members, decided], () => {
      const settled = decided.get()
      const model = reviewCardsModel(
        state.reviews.get(),
        channel.slug,
        state.reviewsRead.get(),
        state.members.get(),
        focus,
      )
      if (!broughtIntoView && model.cards.some((card) => card.focused)) {
        broughtIntoView = true
        context.page.nextFrame(() => bringIntoView(panel.querySelector(FOCUSED_CARD)))
      }
      return h(
        'section',
        { class: 'reviews' },
        h('h3', {}, model.title),
        settled !== null &&
          h(
            'p',
            { class: 'hint review-decided', role: 'status' },
            decidedAnswerModel(settled.note, signedIn(state)?.member.id ?? null, state.members.get()),
          ),
        model.none !== null && h('p', { class: 'hint' }, model.none),
        h(
          'ul',
          { class: 'review-cards' },
          model.cards.map((card) => {
            const element = reviewCard(context, card, () => {
              if (card.focused) askedWhatBecameOfFocus = true
            })
            reportWhenSeen(context, element, card.review.note)
            return element
          }),
        ),
      )
    }),
    region(life, [figures], () =>
      renderFigures(channelAgentFiguresModel(figures.get(), channel.slug, FIGURES_DAYS)),
    ),
  )
  return panel
}

const FIGURES_DAYS = 30

const renderFigures = (model: ChannelAgentFiguresModel): Child => {
  if (model.kind === 'hidden') return null
  if (model.kind === 'loading') return loading()
  if (model.kind === 'failed') return h('p', { class: 'hint', role: 'status' }, model.text)
  return h(
    'section',
    { class: 'channel-agent-figures' },
    h('h3', {}, model.title),
    h('p', { class: 'hint' }, model.intro),
    h(
      'div',
      { class: 'table-scroll trust-table-scroll' },
      h(
        'table',
        { class: 'trust-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            model.headings.map((heading) => h('th', { scope: 'col' }, heading)),
          ),
        ),
        h(
          'tbody',
          {},
          model.rows.map(([label, now, before]) =>
            h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, now), h('td', {}, before)),
          ),
        ),
      ),
    ),
    h('p', {}, model.waiting),
    h('h4', {}, model.approvalsTitle),
    h('p', { class: 'hint' }, model.approvalsHint),
    h(
      'ul',
      { class: 'channel-agent-approvals' },
      model.approvals.map((line) => h('li', {}, line)),
    ),
    h('p', { class: 'hint' }, model.footnote),
  )
}

const FOCUSED_CARD = '.review-card[aria-current="true"]'

const bringIntoView = (card: HTMLElement | null): void => {
  card?.scrollIntoView({ block: 'center' })
  card?.focus({ preventScroll: true })
}

const agentState = (
  loaded: 'loading' | 'loaded' | 'failed',
  agents: ReadonlyMap<string, AsRead.ChannelAgent>,
  slug: string,
): AsRead.ChannelAgent | null | 'loading' | 'failed' =>
  loaded === 'loaded' ? (agents.get(slug) ?? null) : loaded

/** The section that makes a join code stays the same element across renders, so a shown code survives them. */
const renderPanel = (
  model: AgentPanel,
  context: ViewContext,
  channel: AsRead.Channel,
  joinCodeFor: (name: string) => HTMLElement | null,
): Child => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'failed') return h('p', { class: 'hint', role: 'status' }, model.text)
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
    joinCodeFor(model.name),
    h(
      'details',
      { class: 'retire-agent-step' },
      h('summary', {}, strings.channelAgent.retire),
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
        h('button', { type: 'submit', class: 'danger' }, strings.channelAgent.retire),
      ),
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

/** `decides` runs before the person sends or discards, so their own decision is not told back to them. */
const reviewCard = (context: ViewContext, card: ReviewCard, decides: () => void): HTMLElement =>
  h(
    'li',
    {
      class: 'review-card',
      data: { note: card.review.note.id },
      ...(card.focused && { 'aria-current': 'true', tabindex: '-1' }),
    },
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
          button(
            card.discard,
            () => {
              decides()
              context.actions.discardReview(card.review)
            },
            { class: 'danger' },
          ),
          button(
            card.send,
            () => {
              decides()
              context.actions.sendReview(card.review, null, { attempt: 'draft' })
            },
            { class: 'primary' },
          ),
        ),
  )

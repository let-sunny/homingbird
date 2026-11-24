import type { AsRead, NoteId } from '@homingbird/protocol'
import { CHANNEL_AGENT_NAME_MAX, DISCARD_REASON_MAX } from '@homingbird/protocol'
import { type Child, type Lifetime, derived, h, linkedText, region, signal, slice } from '@homingbird/ui'
import type { ChannelAgentState } from '../channel-answerers.ts'
import { channelLabel } from '../channels.ts'
import { featureOn } from '../features.ts'
import { heldLineFor } from '../held-decisions.ts'
import {
  type ChannelAgentFiguresModel,
  type ChannelAgentFiguresState,
  channelAgentFiguresModel,
} from '../models/channel-agent-figures.ts'
import {
  type AgentPanel,
  type AgentPanelPlace,
  type ReviewCard,
  agentControlsModel,
  agentPanelModel,
  channelAgentPageModel,
  decidedAnswerModel,
  reviewCardsModel,
} from '../models/channel-agent.ts'
import {
  type ChannelAgentTab,
  type ChannelAgentTabs,
  channelAgentTabsModel,
} from '../models/channel-teaching.ts'
import { firstAnswersStep, listWaitModel } from '../models/start.ts'
import { signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import { channelDecisionsSection } from './channel-decisions.ts'
import { channelTeachingSection } from './channel-teaching.ts'
import type { ViewContext } from './context.ts'
import { cardOf, focusAfterDecision } from './decision-focus.ts'
import { closeDialog, closesDialog, opensDialog, submitOnModifierEnter } from './dialog.ts'
import { reportWhenSeen } from './drafts-item.ts'
import { renderHeldLine } from './held-toast.ts'
import { hinted } from './hint.ts'
import { joinCodeSection } from './join-code.ts'
import { noteBody } from './note-body.ts'
import { button, field, listWait, loading, page as pageOf, slackReplyLines, sourceList } from './parts.ts'

/** The agent's buttons among a channel's own controls: its panel for a manager, and asking it privately. */
export const agentButtons = (context: ViewContext, channel: AsRead.Channel): Child => {
  const model = agentControlsModel(channel, context.state.serverInfo.get())
  return [
    model.manage !== null &&
      hinted(
        context,
        'channelAgent',
        strings.hints.channelAgent,
        h(
          'button',
          {
            type: 'button',
            class: 'channel-agent-open',
            ...opensDialog(context, model.manage, (life) =>
              agentPanel(context, life, channel, null, 'dialog'),
            ),
          },
          model.manage,
        ),
      ),
    model.askPrivately !== null &&
      hinted(
        context,
        'privateQuestion',
        strings.hints.privateQuestion,
        button(model.askPrivately, () => context.actions.askPrivately(channel.slug), {
          class: 'ask-privately',
        }),
      ),
  ]
}

/** Beside the conversations: how many answers wait for the person to review, and where. */
/**
 * The page of a channel's agent, where a desk connected as it sends its managers to review its answers,
 * and a review notification opens one answer's card.
 */
export const channelAgentView = (
  context: ViewContext,
  life: Lifetime,
  slug: string,
  focus: string | null,
  asked: ChannelAgentTab,
): HTMLElement => {
  const { state, actions } = context
  actions.loadKnownChannels()
  const tabs = channelAgentTabsModel(slug, state.serverInfo.get(), asked)
  return h(
    'div',
    { class: 'channel-agent-page' },
    region(life, [state.channels, state.channelsLoaded], () => {
      const page = channelAgentPageModel(state.channels.get(), state.channelsLoaded.get(), slug)
      if (page.kind === 'loading') return loading()
      if (page.kind === 'missing') return h('p', { class: 'hint' }, page.text)
      return pageOf(
        page.title,
        page.agentState !== null && channelAgentStateLine(page.agentState),
        renderTabs(tabs),
        tabs.shown === 'teach'
          ? channelTeachingSection(context, life, slug, page.channel.agent?.name ?? channelLabel(slug))
          : agentPanel(context, life, page.channel, focus, 'page'),
      )
    }),
  )
}

const renderTabs = (model: ChannelAgentTabs): Child =>
  model.tabs.length > 1 &&
  h(
    'nav',
    { class: 'subtabs channel-agent-tabs', 'aria-label': model.label },
    model.tabs.map((tab) => h('a', { href: tab.href, 'aria-current': tab.current && 'page' }, tab.label)),
  )

/**
 * The agent of a channel the person manages: in the dialog its name, desks and retiring it, with a way to
 * its page; on its page the answers waiting first and what was recently decided, then the same, then how
 * it is doing.
 */
const agentPanel = (
  context: ViewContext,
  life: Lifetime,
  channel: AsRead.Channel,
  focus: string | null,
  place: AgentPanelPlace,
): HTMLElement => {
  const { state, actions } = context
  const loaded = signal<'loading' | 'loaded' | 'failed'>('loading')
  let joinSection: { readonly name: string; readonly element: HTMLElement } | null = null
  const joinCodeFor = (name: string): HTMLElement | null => {
    if (!featureOn('joinCodes', state.serverInfo.get())) return null
    if (joinSection?.name !== name)
      joinSection = {
        name,
        element: joinCodeSection(context, life, { channel: channel.slug, name }, () => {
          actions.loadChannelAgent(channel.slug)
          actions.reloadKnownChannels()
        }),
      }
    return joinSection.element
  }
  actions.loadChannelAgent(channel.slug, {
    done: () => loaded.set('loaded'),
    failed: () => loaded.set('failed'),
  })
  const retiring = { open: false }
  const setup = region(life, [loaded, state.channelAgents, state.members], () =>
    renderPanel(
      agentPanelModel(
        agentState(loaded.get(), state.channelAgents.get(), channel.slug),
        state.members.get(),
        place,
        featureOn('joinCodes', state.serverInfo.get()),
      ),
      context,
      channel,
      joinCodeFor,
      retiring,
    ),
  )
  if (place === 'dialog') return h('div', { class: 'dialog-body channel-agent-panel' }, setup)
  const panel: HTMLElement = h(
    'div',
    { class: 'channel-agent-panel' },
    waitingAnswers(context, life, channel, focus, (): HTMLElement => panel),
    channelDecisionsSection(context, life, channel),
    setup,
    agentFigures(context, life, channel),
  )
  return panel
}

/** The answers waiting in the channel; the one a notification opened is brought into view, once. */
const waitingAnswers = (
  context: ViewContext,
  life: Lifetime,
  channel: AsRead.Channel,
  focus: string | null,
  host: () => HTMLElement,
): HTMLElement => {
  const { state, actions } = context
  const decided = signal<{ readonly note: AsRead.Note | null } | null>(null)
  let broughtIntoView = false
  let askedWhatBecameOfFocus = false
  const learnWhatBecameOfFocus = (): void => {
    const isWaiting = state.reviews.get().some((review) => review.note.id === focus)
    if (focus === null || isWaiting || askedWhatBecameOfFocus) return
    askedWhatBecameOfFocus = true
    actions.loadDecidedAnswer(focus as NoteId, { done: (note) => decided.set({ note }) })
  }
  actions.refreshReviews({
    done: (answered) => {
      if (answered) learnWhatBecameOfFocus()
      life.add(state.reviews.subscribe(learnWhatBecameOfFocus))
    },
  })
  const awaited = slice([state.reviews.load], () => firstAnswersStep([state.reviews.load.get()]))
  const sources = [
    state.reviews,
    state.reviewsRead,
    state.members,
    decided,
    state.held,
    state.draftEdits,
    state.channels,
    state.workspace,
    awaited,
  ]
  return region(life, sources, () => {
    const settled = decided.get()
    const step = awaited.get()
    const model = reviewCardsModel(
      state.reviews.get(),
      channel.slug,
      state.reviewsRead.get(),
      state.members.get(),
      state.draftEdits.get(),
      focus,
      state.channels.get(),
    )
    if (!broughtIntoView && model.cards.some((card) => card.focused)) {
      broughtIntoView = true
      context.page.nextFrame(() => bringIntoView(host().querySelector(FOCUSED_CARD)))
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
      model.none !== null &&
        (step === null
          ? h('p', { class: 'hint' }, model.none)
          : listWait(
              listWaitModel(step, state.workspace.get(), strings.checking.waiting),
              actions.askActivityAgain,
            )),
      h(
        'ul',
        { class: 'review-cards' },
        model.cards.map((card) => {
          const line = heldLineFor(state.held.get(), [card.review.note.id])
          if (line !== null) return renderHeldLine(context, line)
          const element = reviewCard(context, card, () => {
            if (card.focused) askedWhatBecameOfFocus = true
          })
          reportWhenSeen(context, element, card.review.note)
          return element
        }),
      ),
    )
  })
}

/** How the agent is doing, read again whenever an answer in the channel is sent or discarded. */
const agentFigures = (context: ViewContext, life: Lifetime, channel: AsRead.Channel): HTMLElement => {
  const { state, actions } = context
  const figures = signal<ChannelAgentFiguresState>('loading')
  let latestFigures = 0
  const loadFigures = (): void => {
    const asked = ++latestFigures
    actions.loadChannelAgentFigures(channel.slug, {
      done: (report) => asked === latestFigures && figures.set(report),
      failed: () => asked === latestFigures && figures.set('failed'),
    })
  }
  const waitingHere = derived([state.reviews], (reviews) =>
    reviews
      .filter((review) => review.channel === channel.slug)
      .map((review) => review.note.id)
      .join(' '),
  )
  loadFigures()
  life.add(waitingHere.subscribe(loadFigures))
  return region(life, [figures], () =>
    renderFigures(channelAgentFiguresModel(figures.get(), channel.slug, FIGURES_DAYS)),
  )
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
  retiring: { open: boolean },
): Child => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'failed') return h('p', { class: 'hint', role: 'status' }, model.text)
  if (model.kind === 'none')
    return [
      h('p', {}, model.intro),
      h('p', { class: 'hint' }, model.text),
      nameForm(model.create, '', (name) => context.actions.createChannelAgent(channel.slug, name), 'primary'),
    ]
  return [
    h('p', {}, model.intro),
    model.page !== null &&
      h(
        'p',
        { class: 'channel-agent-page-link' },
        h(
          'a',
          { class: 'button', href: model.page.href, on: { click: () => closeDialog(context) } },
          model.page.label,
        ),
        h('small', { class: 'hint' }, model.page.hint),
      ),
    nameForm(
      strings.channelAgent.rename,
      model.name,
      (name) => context.actions.renameChannelAgent(channel.slug, name),
      'secondary',
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
      {
        class: 'retire-agent-step',
        open: retiring.open,
        on: { toggle: (event) => (retiring.open = (event.currentTarget as HTMLDetailsElement).open) },
      },
      h('summary', {}, model.retireTitle),
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
        h('p', {}, model.retireBody),
        h('button', { type: 'submit', class: 'danger' }, model.retire),
      ),
    ),
  ]
}

const nameForm = (
  label: string,
  value: string,
  save: (name: string) => void,
  emphasis: 'primary' | 'secondary',
): HTMLElement => {
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
    h('button', { type: 'submit', ...(emphasis === 'primary' && { class: 'primary' }) }, label),
  )
}

/**
 * One answer waiting for review, on the agent's page or under its question in the room. `decides` runs
 * before the person sends or discards, so their own decision is not told back to them.
 */
export const reviewCard = (
  context: ViewContext,
  card: ReviewCard,
  decides: () => void = () => {},
): HTMLElement =>
  h(
    'li',
    {
      class: 'review-card',
      data: { note: card.review.note.id, decides: card.review.note.id, decisionUnit: '' },
      tabindex: '-1',
      ...(card.focused && { 'aria-current': 'true' }),
    },
    card.heading !== null && h('p', { class: 'review-heading hint' }, card.heading),
    card.privately !== null && h('span', { class: 'review-private' }, card.privately),
    card.question !== null &&
      h(
        'blockquote',
        { class: 'review-question' },
        h('small', {}, card.question.from),
        h('p', {}, card.question.body),
      ),
    slackReplyLines(card.slack),
    noteBody(context, card.body, 'review-body'),
    card.basis !== null &&
      h(
        'div',
        { class: 'review-basis' },
        h('small', {}, card.basis.title),
        card.basis.lines.length > 0 &&
          h(
            'ul',
            {},
            card.basis.lines.map((line) => h('li', {}, linkedText(line))),
          ),
        sourceList(card.basis.sources),
      ),
    card.keptEdit !== null && h('p', { class: 'kept-edit hint', role: 'note' }, card.keptEdit),
    reviewActions(context, card, decides),
    h('p', { class: 'review-why hint' }, card.why),
  )

/** A channel's agent's state as a dot and its words, as a person's agent is shown. */
export const channelAgentStateLine = (state: ChannelAgentState): HTMLElement =>
  h(
    'p',
    { class: 'channel-agent-state', role: 'status' },
    h('span', { class: `agent-mark-dot is-${state.state}`, 'aria-hidden': 'true' }),
    state.label,
  )

/**
 * Send, Edit and Discard in the draft card's order; Send and Discard are held for a moment so the manager
 * can undo either, and Discard first asks why, for the managers alone.
 */
const reviewActions = (context: ViewContext, card: ReviewCard, decides: () => void): HTMLElement => {
  const id = card.review.note.id
  const decide = (from: Element | null): void => {
    decides()
    focusAfterDecision(context, from, id)
  }
  const discard = h(
    'button',
    {
      type: 'button',
      class: 'danger review-discard',
      ...opensDialog(context, card.discarding.title, () =>
        discardForm(context, card, decide, cardOf(context, id)),
      ),
    },
    card.discard,
  )
  if (card.readAgain !== null)
    return h(
      'div',
      { class: 'review-actions read-again', role: 'status' },
      h('p', {}, card.readAgain.notice),
      button(card.readAgain.confirm, () => context.actions.confirmReviewRead(card.review), {
        class: 'primary',
      }),
      discard,
    )
  return h(
    'div',
    { class: 'review-actions' },
    hinted(
      context,
      'approveAndSend',
      strings.hints.approveAndSend,
      button(
        card.send,
        (event) => {
          decide((event.target as Element | null)?.closest('[data-decides]') ?? null)
          context.actions.holdReviewSend(card.review, null, card.held.send, HELD)
        },
        { class: 'primary review-send' },
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'review-edit',
        ...opensDialog(context, strings.channelAgent.editTitle, (life) =>
          answerEditor(context, life, card, decide, cardOf(context, id)),
        ),
      },
      card.edit,
    ),
    discard,
  )
}

/**
 * A manager's own wording of the answer, sent as the agent's answer edited by them. Closing it any way
 * keeps the edit on the card; it is let go once the answer is sent or discarded.
 */
const answerEditor = (
  context: ViewContext,
  life: Lifetime,
  card: ReviewCard,
  decide: (from: Element | null) => void,
  from: Element | null,
): Child => {
  const text = h('textarea', {
    name: 'body',
    rows: '6',
    required: true,
    autofocus: true,
    'aria-label': strings.channelAgent.editLabel,
    on: { keydown: submitOnModifierEnter },
  })
  text.value = card.editText
  life.add(() => context.actions.keepDraftEdit(card.review.note.id, card.body, text.value))
  return h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          decide(from)
          context.actions.holdReviewSend(card.review, text.value, card.held.send, HELD)
          closeDialog(context)
        },
      },
    },
    text,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      h('button', { type: 'submit', class: 'primary' }, strings.channelAgent.sendEdited),
    ),
  )
}

/** Why the manager discards the answer, if they say: kept for the managers, never shown to the asker. */
const discardForm = (
  context: ViewContext,
  card: ReviewCard,
  decide: (from: Element | null) => void,
  from: Element | null,
): Child => {
  const reason = h('textarea', {
    name: 'reason',
    rows: '3',
    maxlength: String(DISCARD_REASON_MAX),
    autofocus: true,
    on: { keydown: submitOnModifierEnter },
  })
  return h(
    'form',
    {
      class: 'dialog-body review-discard-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          decide(from)
          context.actions.holdReviewDiscard(card.review, reason.value, card.held.discard, HELD)
          closeDialog(context)
        },
      },
    },
    field(card.discarding.label, reason, card.discarding.hint),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      h('button', { type: 'submit', class: 'danger' }, card.discarding.confirm),
    ),
  )
}

/** A held send or discard reports a refusal as a draft's, once it reaches the server. */
const HELD = { attempt: 'draft' } as const

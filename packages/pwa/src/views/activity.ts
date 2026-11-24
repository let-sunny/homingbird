import type { AsRead, ConversationId, NoteId } from '@homingbird/protocol'
import {
  type Child,
  type Lifetime,
  h,
  keyedRegion,
  lifetime,
  onAnyChange,
  region,
  slice,
} from '@homingbird/ui'
import {
  type ActivityInput,
  type ActivityItem,
  type ActivityKind,
  type ActivityPlace,
  activityModel,
  activityWaitModel,
} from '../models/activity.ts'
import { firstAnswersStep } from '../models/start.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { reviewCard } from './channel-agent.ts'
import type { ViewContext } from './context.ts'
import { debateSuggestionCard } from './debate-suggestion-card.ts'
import { renderDraftsItem, reportWhenSeen } from './drafts-item.ts'
import { heldToastInPanel, placeHeldToast, renderHeldLine } from './held-toast.ts'
import { hinted } from './hint.ts'
import { bellIcon } from './mute-toggle.ts'
import { button, listWait, timeLabel } from './parts.ts'
import { profileName } from './profile-card.ts'
import { teachFromMiss } from './teaching.ts'

/**
 * The header's bell: how many things wait for the person. It opens the activity panel where popovers
 * exist, and otherwise leads to the activity page, as its address says.
 */
export const activityBell = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  actions.loadActivity()
  life.add(
    state.awaitingReply.subscribe(() => {
      if (state.workspace.get() === 'loaded') actions.loadAwaitedThreads()
    }),
  )
  const shown = slice(activitySources(context), () => {
    const model = activityModel(activityInputOf(context, me))
    return { count: model.count, label: model.label, agent: model.agent?.heading ?? null }
  })
  const onPage = slice([state.route], () => state.route.get().name === 'activity')
  return region(
    life,
    [shown, onPage],
    () => {
      const { count, label, agent } = shown.get()
      return hinted(
        context,
        'activityBell',
        strings.hints.activityBell,
        h(
          'a',
          {
            class: 'activity-bell',
            href: hrefFor({ name: 'activity' }),
            'aria-label': label,
            'aria-controls': ACTIVITY_PANEL_ID,
            'aria-current': onPage.get() && 'page',
            data: { tour: 'activity' },
            on: {
              click: (event) => {
                const panel = context.document.byId(ACTIVITY_PANEL_ID)
                if (panel === null || onPage.get() || !hasPopover(panel)) return
                event.preventDefault()
                panel.togglePopover()
              },
            },
          },
          bellIcon(false),
          count > 0 && h('span', { class: 'count activity-count', 'aria-hidden': 'true' }, String(count)),
          agent !== null && h('span', { class: 'agent-mark', 'aria-hidden': 'true', title: agent }),
        ),
      )
    },
    { class: 'activity-bell-host' },
  )
}

/**
 * The activity panel the bell opens: anchored below it on a wide screen, a full-height sheet on a
 * narrow one. Its items are drawn only while it is open, so that a draft counts as seen only then. It
 * takes the focus when it opens, and gives it back to the bell when it closes without leading elsewhere.
 */
export const activityPanel = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const body = h('div', { class: 'activity-panel-body' })
  const foot = h('div', { class: 'activity-panel-foot' })
  let open: Lifetime | null = null
  const giveFocusBack = (): void => {
    const leaving = panel.dataset.leaving === 'true'
    delete panel.dataset.leaving
    const focused = context.document.focused()
    const lost = focused === null || focused.matches('body') || panel.contains(focused)
    if (!leaving && lost) context.document.find('.activity-bell')?.focus()
  }
  const close = (): void => {
    open?.end()
    open = null
    body.replaceChildren()
    foot.replaceChildren()
    placeHeldToast(context, false)
  }
  const panel: HTMLElement = h(
    'div',
    {
      id: ACTIVITY_PANEL_ID,
      popover: 'auto',
      class: 'activity-panel',
      role: 'dialog',
      tabindex: '-1',
      'aria-labelledby': `${ACTIVITY_PANEL_ID}-title`,
      on: {
        toggle: (event) => {
          if ((event as ToggleEvent).newState !== 'open') {
            close()
            return giveFocusBack()
          }
          close()
          open = lifetime()
          body.replaceChildren(activityContent(context, open, me))
          foot.replaceChildren(heldToastInPanel(context, open))
          placeHeldToast(context, true)
          context.actions.loadActivity()
          panel.focus()
        },
        click: (event) => {
          if ((event.target as Element | null)?.closest?.('a[href]') != null) hideLeaving(panel)
        },
      },
    },
    h(
      'header',
      { class: 'activity-panel-head' },
      h('h2', { id: `${ACTIVITY_PANEL_ID}-title` }, strings.activity.title),
      h('a', { class: 'activity-page-link', href: hrefFor({ name: 'activity' }) }, strings.activity.openPage),
      h(
        'button',
        {
          type: 'button',
          class: 'icon',
          'aria-label': strings.close,
          popovertarget: ACTIVITY_PANEL_ID,
          popovertargetaction: 'hide',
        },
        '✕',
      ),
    ),
    body,
    foot,
  )
  life.add(() => close())
  life.add(
    context.state.route.subscribe(() => {
      if (hasPopover(panel) && panel.matches(':popover-open')) hideLeaving(panel)
    }),
  )
  return panel
}

/** The same list as a page, which the bell's address opens. */
export const activityView = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  context.actions.loadActivity()
  return h(
    'section',
    { class: 'page activity-page' },
    h('h1', {}, strings.activity.title),
    activityContent(context, life, me),
  )
}

export const ACTIVITY_PANEL_ID = 'activity-panel'

/** What the activity model reads, as the state holds it now. */
export const activityInputOf = ({ state, clock }: ViewContext, me: AsRead.Me): ActivityInput => ({
  me,
  threads: state.threads.get(),
  conversations: state.conversations.get(),
  channels: state.channels.get(),
  members: state.members.get(),
  directory: state.directory.get(),
  draftsRead: state.draftsRead.get(),
  draftEdits: state.draftEdits.get(),
  draftRequests: state.draftRequests.get(),
  releases: state.releases.get(),
  reviews: state.reviews.get(),
  held: state.held.get(),
  reviewsRead: state.reviewsRead.get(),
  debates: state.debates.get(),
  suggestions: state.suggestions.get(),
  taught: state.taught.get(),
  agentReport: state.agentReport.get(),
  serverInfo: state.serverInfo.get(),
  now: clock.now(),
})

/** The state the activity model reads; a change to any may change what waits. */
export const activitySources = ({ state }: ViewContext) => [
  state.threads,
  state.conversations,
  state.channels,
  state.members,
  state.directory,
  state.draftsRead,
  state.draftRequests,
  state.releases,
  state.reviews,
  state.reviewsRead,
  state.debates,
  state.suggestions,
  state.taught,
  state.agentReport,
  state.serverInfo,
  state.held,
  state.draftEdits,
]

/**
 * The groups, each a keyed list that stays in place while others come and go: a change to one item
 * redraws that item only, and an item leaves once it no longer waits. While it is shown, conversations
 * that get a draft are loaded as they get it.
 */
const activityContent = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  const sources = activitySources(context)
  const model = () => activityModel(activityInputOf(context, me))
  life.add(state.conversations.subscribe(() => actions.loadDraftThreads()))
  const loads = [state.awaitingReply, state.reviews, state.suggestions, state.debates].map((one) => one.load)
  const wait = slice([...sources, ...loads, state.workspace], () =>
    activityWaitModel({
      empty: model().empty,
      awaited: firstAnswersStep(loads.map((load) => load.get())),
      workspace: state.workspace.get(),
    }),
  )
  const agent = slice(sources, () => model().agent)
  return h(
    'div',
    { class: 'activity' },
    region(life, [wait], () => {
      const shown = wait.get()
      if (shown === null) return null
      if (shown.kind === 'none' || shown.kind === 'checking')
        return h('p', { class: 'activity-empty' }, shown.text)
      return listWait(shown, actions.askAgain)
    }),
    region(life, [agent], () => {
      const notice = agent.get()
      return (
        notice !== null &&
        h(
          'div',
          { class: 'activity-unavailable', role: 'status' },
          h('strong', {}, notice.heading),
          notice.lines.map((line) => h('p', {}, line)),
          h('a', { class: 'button', href: notice.href }, notice.label),
        )
      )
    }),
    ACTIVITY_KINDS.map((kind) => {
      const items = () => model().groups.find((group) => group.kind === kind)?.items ?? []
      const section = h(
        'section',
        { class: 'activity-group', data: { kind } },
        activityHeading(context, kind),
        keyedRegion(life, h('ul', { class: 'activity-list' }), sources, items, {
          key: (item) => item.key,
          signature: (item) => JSON.stringify(item),
          render: (item) => renderItem(context, life, me, item),
        }),
      )
      const showWhenAny = (): void => {
        section.hidden = items().length === 0
      }
      showWhenAny()
      life.add(onAnyChange(sources, showWhenAny))
      return section
    }),
  )
}

const ACTIVITY_KINDS: ReadonlyArray<ActivityKind> = ['drafts', 'reviews', 'suggestions', 'skipped', 'debates']

/** A group's heading, with a hint for the kinds other messengers lack: skipped notes and flocks. */
const activityHeading = (context: ViewContext, kind: ActivityKind): Child => {
  const heading = h('h3', {}, strings.activity.groups[kind])
  if (kind === 'skipped') return hinted(context, 'skippedDraft', strings.hints.skippedDraft, heading)
  if (kind === 'debates') return hinted(context, 'debateRoom', strings.hints.debateRoom, heading)
  return heading
}

const renderItem = (context: ViewContext, life: Lifetime, me: AsRead.Me, item: ActivityItem): HTMLElement => {
  const head = placeLine(item.place)
  switch (item.type) {
    case 'drafts': {
      const element = renderDraftsItem(context, item.drafts)
      element.classList.add('activity-item')
      element.prepend(head)
      return element
    }
    case 'review': {
      const element = reviewCard(context, item.card)
      element.classList.add('activity-item')
      element.prepend(head)
      reportWhenSeen(context, element, item.card.review.note)
      return element
    }
    case 'suggestion': {
      const element = debateSuggestionCard(context, life, me, item.card)
      element.classList.add('activity-item')
      element.prepend(head)
      return element
    }
    case 'held': {
      const element = renderHeldLine(context, item.line)
      element.classList.add('activity-item')
      element.prepend(head)
      return element
    }
    case 'drafts-loading':
      return h('li', { class: 'activity-item' }, head, h('p', { class: 'loading' }, item.text))
    case 'skipped':
      return h(
        'li',
        { class: 'activity-item activity-skipped' },
        head,
        h(
          'blockquote',
          { class: 'activity-quote' },
          h('small', {}, profileName(item.fromId, item.from)),
          h('p', {}, item.body),
        ),
        h('p', { class: 'released' }, item.reason),
        h(
          'div',
          { class: 'activity-actions' },
          button(item.reply, () => replyYourself(context, item.place.href, item.replyTo)),
          item.teach !== null && teachFromMiss(context, item.teach.label, item.teach.seed),
        ),
      )
    case 'debate':
      return h(
        'li',
        { class: 'activity-item activity-debate' },
        head,
        h('p', {}, item.text),
        h('a', { class: 'button', href: item.place.href }, item.place.label),
      )
  }
}

/** Closes the panel for another place, which then decides where the focus goes. */
const hideLeaving = (panel: HTMLElement): void => {
  panel.dataset.leaving = 'true'
  panel.hidePopover()
}

/**
 * Closes the panel before the conversation opens, so the page underneath never shows through, sets
 * the reply target and leaves the focus to the composer.
 */
const replyYourself = (
  context: ViewContext,
  href: string,
  target: { readonly conversationId: ConversationId; readonly noteId: NoteId },
): void => {
  const panel = context.document.byId(ACTIVITY_PANEL_ID)
  if (panel !== null && hasPopover(panel) && panel.matches(':popover-open')) hideLeaving(panel)
  context.actions.replyTo(target.conversationId, target.noteId)
  context.page.go(href)
}

const placeLine = (place: ActivityPlace): HTMLElement =>
  h(
    'p',
    { class: 'activity-place' },
    h('a', { href: place.href, title: place.label }, place.text),
    place.time !== null && timeLabel(place.time),
  )

const hasPopover = (element: HTMLElement): boolean =>
  typeof (element as { togglePopover?: unknown }).togglePopover === 'function'

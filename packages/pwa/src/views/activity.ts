import type { AsRead, ConversationId, NoteId } from '@homingbird/protocol'
import { type Lifetime, h, keyedRegion, lifetime, onAnyChange, region, slice } from '@homingbird/ui'
import { reviewsWithoutHeld, threadsWithoutHeld } from '../held-decisions.ts'
import {
  type ActivityInput,
  type ActivityItem,
  type ActivityKind,
  type ActivityPlace,
  activityModel,
} from '../models/activity.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { reviewCard } from './channel-agent.ts'
import type { ViewContext } from './context.ts'
import { renderDraftsItem, reportWhenSeen } from './drafts-item.ts'
import { bellIcon } from './mute-toggle.ts'
import { button, timeLabel } from './parts.ts'
import { teachFromMiss } from './teaching.ts'

/**
 * The header's bell: how many things wait for the person. It opens the activity panel where popovers
 * exist, and otherwise leads to the activity page, as its address says.
 */
export const activityBell = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  actions.loadActivity()
  const shown = slice(sourcesOf(context), () => {
    const model = activityModel(activityInputOf(context, me))
    return { count: model.count, label: model.label, agent: model.agent?.heading ?? null }
  })
  const onPage = slice([state.route], () => state.route.get().name === 'activity')
  return region(
    life,
    [shown, onPage],
    () => {
      const { count, label, agent } = shown.get()
      return h(
        'a',
        {
          class: 'activity-bell',
          href: hrefFor({ name: 'activity' }),
          'aria-label': label,
          'aria-controls': ACTIVITY_PANEL_ID,
          'aria-current': onPage.get() && 'page',
          title: label,
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

/**
 * The groups, each a keyed list that stays in place while others come and go: a change to one item
 * redraws that item only, and an item leaves once it no longer waits. While it is shown, conversations
 * that get a draft are loaded as they get it.
 */
const activityContent = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  const sources = sourcesOf(context)
  const model = () => activityModel(activityInputOf(context, me))
  life.add(state.conversations.subscribe(() => actions.loadDraftThreads()))
  const empty = slice(sources, () => model().empty)
  const agent = slice(sources, () => model().agent)
  return h(
    'div',
    { class: 'activity' },
    region(life, [empty], () => {
      const text = empty.get()
      return text !== null && h('p', { class: 'activity-empty' }, text)
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
        h('h3', {}, strings.activity.groups[kind]),
        keyedRegion(life, h('ul', { class: 'activity-list' }), sources, items, {
          key: (item) => item.key,
          signature: (item) => JSON.stringify(item),
          render: (item) => renderItem(context, item),
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

const ACTIVITY_KINDS: ReadonlyArray<ActivityKind> = ['drafts', 'reviews', 'skipped', 'debates']

const renderItem = (context: ViewContext, item: ActivityItem): HTMLElement => {
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
    case 'drafts-loading':
      return h('li', { class: 'activity-item' }, head, h('p', { class: 'loading' }, item.text))
    case 'skipped':
      return h(
        'li',
        { class: 'activity-item activity-skipped' },
        head,
        h('blockquote', { class: 'activity-quote' }, h('small', {}, item.from), h('p', {}, item.body)),
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

const activityInputOf = ({ state, clock }: ViewContext, me: AsRead.Me): ActivityInput => ({
  me,
  threads: threadsWithoutHeld(state.threads.get(), state.held.get()),
  conversations: state.conversations.get(),
  channels: state.channels.get(),
  members: state.members.get(),
  directory: state.directory.get(),
  draftsRead: state.draftsRead.get(),
  draftRequests: state.draftRequests.get(),
  releases: state.releases.get(),
  reviews: reviewsWithoutHeld(state.reviews.get(), state.held.get()),
  reviewsRead: state.reviewsRead.get(),
  debates: state.debates.get(),
  taught: state.taught.get(),
  agentReport: state.agentReport.get(),
  serverInfo: state.serverInfo.get(),
  now: clock.now(),
})

const sourcesOf = ({ state }: ViewContext) => [
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
  state.taught,
  state.agentReport,
  state.serverInfo,
  state.held,
]

const hasPopover = (element: HTMLElement): boolean =>
  typeof (element as { togglePopover?: unknown }).togglePopover === 'function'

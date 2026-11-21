import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h, keyedRegion, lifetime, onAnyChange, region, slice } from '@homingbird/ui'
import { featureOn } from '../features.ts'
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
import { timeLabel } from './parts.ts'

/**
 * The header's bell: how many things wait for the person. It opens the activity panel where popovers
 * exist, and otherwise leads to the activity page, as its address says.
 */
export const activityBell = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  if (featureOn('debateRooms', state.serverInfo.get()) && !state.debatesLoaded.get()) actions.loadDebates()
  const shown = slice(sourcesOf(context), () => {
    const model = activityModel(activityInputOf(context, me))
    return { count: model.count, label: model.label }
  })
  const onPage = slice([state.route], () => state.route.get().name === 'activity')
  return region(
    life,
    [shown, onPage],
    () => {
      const { count, label } = shown.get()
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
      )
    },
    { class: 'activity-bell-host' },
  )
}

/**
 * The activity panel the bell opens: anchored below it on a wide screen, a full-height sheet on a
 * narrow one. Its items are drawn only while it is open, so that a draft counts as seen only then.
 */
export const activityPanel = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const body = h('div', { class: 'activity-panel-body' })
  let open: Lifetime | null = null
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
      'aria-labelledby': `${ACTIVITY_PANEL_ID}-title`,
      on: {
        toggle: (event) => {
          if ((event as ToggleEvent).newState !== 'open') return close()
          close()
          open = lifetime()
          body.replaceChildren(activityContent(context, open, me))
          context.actions.loadActivity()
        },
        click: (event) => {
          if ((event.target as Element | null)?.closest?.('a[href]') != null) panel.hidePopover()
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
      if (hasPopover(panel) && panel.matches(':popover-open')) panel.hidePopover()
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
  return h(
    'div',
    { class: 'activity' },
    region(life, [empty], () => {
      const text = empty.get()
      return text !== null && h('p', { class: 'activity-empty' }, text)
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

const ACTIVITY_KINDS: ReadonlyArray<ActivityKind> = ['drafts', 'reviews', 'skipped', 'unavailable', 'debates']

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
        h('a', { class: 'button', href: item.place.href }, item.reply),
      )
    case 'unavailable':
      return h(
        'li',
        { class: 'activity-item activity-unavailable', role: 'status' },
        h('strong', {}, item.heading),
        item.lines.map((line) => h('p', {}, line)),
        h('a', { class: 'button', href: item.place.href }, item.place.label),
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

const placeLine = (place: ActivityPlace): HTMLElement =>
  h(
    'p',
    { class: 'activity-place' },
    h('a', { href: place.href, title: place.label }, place.text),
    place.time !== null && timeLabel(place.time),
  )

const activityInputOf = ({ state, clock }: ViewContext, me: AsRead.Me): ActivityInput => ({
  me,
  threads: state.threads.get(),
  conversations: state.conversations.get(),
  channels: state.channels.get(),
  members: state.members.get(),
  directory: state.directory.get(),
  draftsRead: state.draftsRead.get(),
  draftRequests: state.draftRequests.get(),
  releases: state.releases.get(),
  reviews: state.reviews.get(),
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
]

const hasPopover = (element: HTMLElement): boolean =>
  typeof (element as { togglePopover?: unknown }).togglePopover === 'function'

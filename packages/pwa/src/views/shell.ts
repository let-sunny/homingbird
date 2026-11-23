import type { AsRead } from '@homingbird/protocol'
import {
  type Child,
  type Lifetime,
  type ReadableSignal,
  h,
  keyedRegion,
  region,
  slice,
  svg,
} from '@homingbird/ui'
import { peopleConversations } from '../channels.ts'
import { connectionShown } from '../connection-status.ts'
import { featureOn } from '../features.ts'
import { conversationsWithoutHeld, reviewsWithoutHeld } from '../held-decisions.ts'
import { agentNotice } from '../models/activity.ts'
import { memberAvatarOf } from '../models/avatar.ts'
import { logoOf, wordmark } from '../models/branding.ts'
import {
  type ConversationRow,
  type SidebarModel,
  type TabGlyph,
  paneFor,
  searchLinkModel,
  sidebarModel,
  skipLinkModel,
  tabBarFor,
  tabsModel,
  userMenuModel,
} from '../models/shell.ts'
import { type Waiting, waitingFilterModel } from '../models/waiting.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { activityBell, activityPanel } from './activity.ts'
import { leaveForm } from './channel-membership.ts'
import { renderAvatar, renderGroupAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { conversationActionItems } from './conversation-actions.ts'
import { opensDialog } from './dialog.ts'
import { startingPoints } from './home.ts'
import { type MenuParts, actionMenu } from './menu.ts'
import { mutedMark } from './mute-toggle.ts'
import { newChannelButton, newMessageLink } from './new-buttons.ts'
import {
  agentDot,
  archivedMark,
  button,
  channelCounts,
  empty,
  humanDot,
  loading,
  timeLabel,
} from './parts.ts'
import { switcher } from './switcher.ts'
import { renderTurningPip } from './turning-bird.ts'
import { watchWaiting } from './waiting.ts'

/** The app around a page: the header with its tabs, the connection, the sidebar and the user menu. */
export const shell = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  stage: HTMLElement,
): HTMLElement => {
  const { state } = context
  const waiting = watchWaiting(context, life, me)
  const app = h(
    'div',
    { class: 'app' },
    titleBar(context, life, me),
    connectionNotice(context, life),
    sidebar(context, life, me, waiting),
    stage,
  )
  const showPane = (): void => {
    app.dataset.pane = paneFor(state.route.get())
    app.dataset.tabBar = tabBarFor(state.route.get())
  }
  showPane()
  life.add(state.route.subscribe(showPane))
  return h(
    'div',
    { class: 'viewport' },
    skipLink(context, life),
    app,
    userMenu(context, me),
    activityPanel(context, life, me),
    switcher(context, life, me, waiting),
  )
}

/** Shown only once focused: in a conversation, the first Tab offers to go straight to writing a note. */
const skipLink = (context: ViewContext, life: Lifetime): HTMLElement =>
  region(
    life,
    [context.state.route],
    () => {
      const label = skipLinkModel(context.state.route.get())
      return (
        label !== null &&
        button(label, () => context.document.find('.composer textarea:not([disabled])')?.focus(), {
          class: 'skip-link visually-hidden',
        })
      )
    },
    { class: 'skip-link-host' },
  )

const USER_MENU_ID = 'user-menu'

const connectionNotice = (context: ViewContext, life: Lifetime): HTMLElement =>
  region(
    life,
    [context.state.connection],
    () => {
      const shown = connectionShown(context.state.connection.get(), strings)
      return shown.state === 'offline' && h('p', { class: 'connection-notice' }, shown.description)
    },
    { class: 'connection-notice-host' },
  )

const titleBar = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state } = context
  const branding = state.branding.get()
  const agentUnavailable = slice(
    [state.directory],
    () => agentNotice({ me, directory: state.directory.get() })?.heading ?? null,
  )
  return h(
    'header',
    { class: 'titlebar' },
    h(
      'a',
      { class: 'brand', href: '#/', 'aria-label': branding.name },
      branding.logo === null
        ? renderTurningPip(1)
        : h('img', { class: 'mark', src: logoOf(branding.logo), alt: '', width: '32', height: '32' }),
      h('span', { class: 'wordmark' }, wordmark(branding.name)),
    ),
    region(life, [state.route, agentUnavailable], () => tabs(context, agentUnavailable.get()), {
      class: 'tabs-host',
    }),
    region(
      life,
      [state.connection],
      () => {
        const shown = connectionShown(state.connection.get(), strings)
        return h(
          'span',
          {
            class: `connection is-${shown.state}`,
            role: 'status',
            title: shown.description,
            'aria-label': shown.description,
            data: { noticeable: String(shown.noticeable), shown: shown.shown },
          },
          h('span', { class: 'connection-mark', 'aria-hidden': 'true' }),
          h('span', { class: 'connection-label', 'aria-hidden': 'true' }, shown.label),
        )
      },
      { class: 'connection-host' },
    ),
    h(
      'div',
      { class: 'header-actions' },
      region(life, [state.route], () => searchLink(context), { class: 'search-link-host' }),
      activityBell(context, life, me),
      userButton(context, life, me),
    ),
  )
}

/**
 * The tabs on one row; where the row scrolls sideways, the current tab is scrolled into view, and a
 * chevron at either end that has more scrolls the row that way. The chevrons repeat what a swipe or
 * the Tab key already does, so they stay out of the keyboard order and away from screen readers.
 */
const tabs = (context: ViewContext, agentUnavailable: string | null): Child => {
  const { state } = context
  const shown = tabsModel(state.route.get(), state.serverInfo.get(), agentUnavailable).map((tab) => ({
    tab,
    link: h(
      'a',
      {
        href: tab.href,
        class: 'tab',
        'aria-current': tab.current && 'page',
        ...(tab.tour !== null && { data: { tour: tab.tour } }),
      },
      tab.glyph !== null && tabGlyph(tab.glyph),
      h('span', { class: 'tab-label' }, tab.label),
      tab.mark !== null &&
        h('span', { class: 'agent-mark', role: 'img', 'aria-label': tab.mark, title: tab.mark }),
    ),
  }))
  const nav = h(
    'nav',
    { class: 'tabs', 'aria-label': strings.sections },
    shown.map(({ link }) => link),
  )
  const current = shown.find(({ tab }) => tab.current)?.link
  if (current !== undefined) context.page.nextFrame(() => scrollTabIntoView(nav, current))
  return [tabsScroller(nav, -1), nav, tabsScroller(nav, 1)]
}

const tabsScroller = (nav: HTMLElement, direction: 1 | -1): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: `tabs-scroll ${direction === 1 ? 'is-later' : 'is-earlier'}`,
      tabindex: '-1',
      'aria-hidden': 'true',
      on: {
        click: () => {
          const inline = nav.closest('[dir="rtl"]') === null ? 1 : -1
          nav.scrollLeft += direction * inline * Math.round(nav.clientWidth * TABS_SCROLL_SHARE)
        },
      },
    },
    direction === 1 ? '›' : '‹',
  )

const searchLink = (context: ViewContext): HTMLElement => {
  const model = searchLinkModel(context.state.route.get())
  return h(
    'a',
    {
      class: 'search-link',
      href: model.href,
      'aria-label': model.label,
      title: model.label,
      'aria-current': model.current && 'page',
    },
    searchIcon(),
  )
}

const userButton = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state } = context
  return region(
    life,
    [state.members],
    () =>
      h(
        'button',
        {
          type: 'button',
          class: 'user-button',
          popovertarget: USER_MENU_ID,
          'aria-label': strings.menu,
          data: { tour: 'profile' },
        },
        renderAvatar(
          context,
          memberAvatarOf(
            state.members.get().get(me.member.id) ?? me.member,
            featureOn('characters', state.serverInfo.get()),
            {
              labelled: false,
            },
          ),
        ),
      ),
    { class: 'user-button-host' },
  )
}

const userMenu = (context: ViewContext, me: AsRead.Me): HTMLElement => {
  const model = userMenuModel(me)
  const menu: HTMLElement = h(
    'div',
    { id: USER_MENU_ID, popover: 'auto', class: 'menu' },
    h('p', { class: 'menu-who' }, h('strong', {}, model.name), h('span', {}, model.email)),
    model.links.map((link) =>
      h('a', { class: 'menu-item', href: link.href, on: { click: () => menu.hidePopover() } }, link.label),
    ),
    h(
      'button',
      { type: 'button', class: 'menu-item', on: { click: () => context.actions.signOut() } },
      model.signOut,
    ),
  )
  return menu
}

const sidebar = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  waiting: ReadableSignal<Waiting>,
): HTMLElement => {
  const { state } = context
  const model = (withArrivals = false): SidebarModel => {
    const conversations = state.conversations.get()
    return sidebarModel({
      waitingOnly: state.waitingOnly.get() ? waiting.get().conversationIds : null,
      me,
      route: state.route.get(),
      conversations: conversationsWithoutHeld(conversations, state.held.get()),
      loaded: state.conversationsLoaded.get(),
      members: state.members.get(),
      directory: state.directory.get(),
      channels: state.channels.get(),
      reviews: reviewsWithoutHeld(state.reviews.get(), state.held.get()),
      agentCount: state.agentCredentials.get().length,
      charactersOn: featureOn('characters', state.serverInfo.get()),
      muteOn: featureOn('mute', state.serverInfo.get()),
      hideOn: featureOn('hideConversations', state.serverInfo.get()),
      leaveOn: featureOn('leaveGroups', state.serverInfo.get()),
      now: context.clock.now(),
      typedIn: state.typedIn.get(),
      arrived: new Set(
        withArrivals
          ? peopleConversations(conversations)
              .filter((conversation) => context.justArrived(conversation, me.member.id))
              .map((conversation) => conversation.id)
          : [],
      ),
    })
  }
  const peopleSources = [
    state.typedIn,
    state.conversations,
    state.members,
    state.directory,
    state.route,
    state.conversationsLoaded,
    state.held,
    state.waitingOnly,
    waiting,
  ]
  const roomSources = [
    state.conversations,
    state.route,
    state.channels,
    state.reviews,
    state.typedIn,
    state.held,
    state.waitingOnly,
    waiting,
  ]
  const archivedSources = [state.conversations, state.route, state.members, state.waitingOnly]
  return h(
    'aside',
    { class: 'sidebar', 'aria-label': strings.conversations },
    region(
      life,
      [state.agentCredentials, state.session, slice(peopleSources, () => model().onboarding)],
      () => model().onboarding && onboarding(),
      {
        class: 'onboarding-host',
      },
    ),
    region(life, [state.waitingOnly, waiting], () => waitingFilter(context, waiting.get()), {
      class: 'waiting-filter-host',
    }),
    h(
      'div',
      { class: 'sidebar-section-head sidebar-list-head' },
      h('h2', { class: 'sidebar-title' }, strings.conversations),
      newMessageLink(context),
    ),
    region(
      life,
      [slice(peopleSources, () => model().people.kind)],
      (drawing) => {
        const people = model().people
        const kind = people.kind
        if (kind === 'loading') return loading()
        if (people.kind === 'nothing-waits') return empty(people.text)
        if (kind === 'none')
          return h(
            'div',
            { class: 'no-conversations' },
            h('p', { class: 'no-conversations-text' }, strings.noConversations),
            startingPoints(context, drawing),
          )
        return rowList(context, drawing, peopleSources, 'conversation-list', () => {
          const people = model(true).people
          return people.kind === 'rows' ? people.rows : []
        })
      },
      { class: 'conversations-host', data: { tour: 'notes' } },
    ),
    h(
      'div',
      { class: 'sidebar-section-head' },
      h('h2', { class: 'sidebar-title' }, strings.channels),
      h(
        'div',
        { class: 'section-actions' },
        h(
          'a',
          { class: 'section-action browse-channels', href: hrefFor({ name: 'channels' }) },
          strings.browseChannels,
        ),
        newChannelButton(context),
      ),
    ),
    region(
      life,
      [slice(roomSources, () => (model().channelRooms.length === 0 ? model().channelRoomsEmpty : null))],
      (drawing) =>
        model().channelRooms.length === 0
          ? empty(model().channelRoomsEmpty)
          : rowList(
              context,
              drawing,
              roomSources,
              'conversation-list channel-rooms',
              () => model().channelRooms,
            ),
    ),
    region(
      life,
      [
        slice(archivedSources, () => {
          const archived = model().archived
          return archived === null ? null : { title: archived.title, open: archived.open }
        }),
      ],
      (drawing) => {
        const archived = model().archived
        return (
          archived !== null &&
          h(
            'details',
            { class: 'archived-rooms', open: archived.open },
            h('summary', { class: 'sidebar-title' }, archived.title),
            rowList(
              context,
              drawing,
              archivedSources,
              'conversation-list',
              () => model().archived?.rows ?? [],
            ),
          )
        )
      },
    ),
  )
}

/** The list's Waiting for you filter, a button that stays pressed while it is on. */
const waitingFilter = (context: ViewContext, waiting: Waiting): HTMLElement => {
  const model = waitingFilterModel(context.state.waitingOnly.get(), waiting)
  return h(
    'button',
    {
      type: 'button',
      class: 'waiting-filter',
      'aria-pressed': String(model.pressed),
      title: model.label,
      on: { click: () => context.state.waitingOnly.update((on) => !on) },
    },
    model.text,
    model.count !== null && h('span', { class: 'count', 'aria-hidden': 'true' }, model.count),
  )
}

const onboarding = (): HTMLElement =>
  h(
    'div',
    { class: 'onboarding', role: 'note' },
    h(
      'div',
      { class: 'onboarding-text' },
      h('strong', {}, strings.onboardingTitle),
      h('p', {}, strings.onboardingHint),
      h(
        'a',
        { class: 'button primary', href: hrefFor({ name: 'agent', section: 'connection' }) },
        strings.connectAgent,
      ),
    ),
  )

/** A list of conversation rows that redraws only the rows whose data changed. */
const rowList = (
  context: ViewContext,
  life: Lifetime,
  sources: ReadonlyArray<ReadableSignal<unknown>>,
  className: string,
  rows: () => ReadonlyArray<ConversationRow>,
): HTMLElement =>
  keyedRegion(life, h('ul', { class: className }), sources, rows, {
    key: (row) => row.id,
    signature: (row) => JSON.stringify(row),
    render: (row) => conversationRow(context, row),
  })

const conversationRow = (context: ViewContext, row: ConversationRow): HTMLElement => {
  const more = row.menu === null ? null : rowMenu(context, row.menu)
  const item = h(
    'li',
    { class: 'conversation-item' },
    h(
      'a',
      { class: 'conversation', href: row.href, 'aria-current': row.current && 'page' },
      h(
        'span',
        { class: 'conversation-face' },
        row.face.kind === 'channel'
          ? h('span', { class: 'avatar is-channel', 'aria-hidden': 'true' }, '#')
          : row.face.kind === 'group'
            ? renderGroupAvatar(context, row.face)
            : renderAvatar(context, row.face.avatar),
        row.presence !== null && agentDot(row.presence),
      ),
      h(
        'span',
        { class: 'conversation-main' },
        h(
          'span',
          { class: 'conversation-name' },
          h('span', { class: 'conversation-title', title: row.title }, row.title),
          row.presence !== null && humanDot(row.presence),
          row.archived && archivedMark(),
          row.mute?.mark != null && mutedMark(row.mute.mark),
        ),
        row.channel !== null && h('span', { class: 'conversation-counts' }, channelCounts(row.channel)),
        h('span', { class: 'conversation-preview' }, row.preview),
      ),
      h(
        'span',
        { class: 'conversation-side' },
        row.typed !== null &&
          h(
            'span',
            { class: 'typed-mark', role: 'img', 'aria-label': row.typed.label, title: row.typed.label },
            row.typed.text,
          ),
        row.time !== null && timeLabel(row.time),
        row.unread !== null &&
          h('span', { class: 'count unread', 'aria-label': row.unread.label }, row.unread.count),
        row.drafts !== null &&
          h(
            'span',
            {
              class: 'count drafts',
              'aria-label': row.drafts.label,
              title: row.drafts.label,
              data: { tour: 'waiting-draft' },
            },
            row.drafts.text,
            h('span', { class: 'count-word', 'aria-hidden': 'true' }, row.drafts.word),
          ),
        row.review !== null &&
          h('span', { class: 'count drafts reviews', 'aria-label': row.review.label }, row.review.text),
      ),
    ),
    more?.trigger,
    more?.menu,
  )
  more?.opensFrom(item)
  return item
}

const rowMenu = (context: ViewContext, menu: NonNullable<ConversationRow['menu']>): MenuParts => {
  const { mute, leave, place } = menu
  const reasonId = `${menu.id}-reason`
  return actionMenu(context, {
    id: menu.id,
    label: menu.label,
    triggerClass: 'conversation-more',
    menuClass: 'conversation-menu',
    items: [
      mute !== null &&
        button(mute.label, () => context.actions.setMuted(mute.conversationId, !mute.muted), {
          class: 'menu-item mute-row',
          title: mute.hint,
        }),
      leave?.kind === 'allowed' &&
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item danger leave-channel',
            ...opensDialog(context, leave.title, () => leaveForm(context, leave.slug, leave.body)),
          },
          strings.leaveChannel,
        ),
      leave?.kind === 'blocked' && [
        h(
          'button',
          { type: 'button', class: 'menu-item leave-channel', disabled: true, 'aria-describedby': reasonId },
          strings.leaveChannel,
        ),
        h('small', { id: reasonId, class: 'menu-reason' }, leave.reason),
      ],
      ...conversationActionItems(context, place),
    ],
  })
}

/** Scrolls only the tab row, so the page itself never jumps. */
/** How much of the visible tab row one press of a chevron scrolls past. */
const TABS_SCROLL_SHARE = 0.75

const scrollTabIntoView = (nav: HTMLElement, tab: HTMLElement): void => {
  const start = tab.offsetLeft - nav.offsetLeft
  const end = start + tab.offsetWidth
  if (start < nav.scrollLeft) nav.scrollLeft = start
  else if (end > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = end - nav.clientWidth
}

const searchIcon = (): SVGElement =>
  svg(
    'svg',
    {
      class: 'search-icon',
      viewBox: '0 0 16 16',
      width: 16,
      height: 16,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    svg('circle', { cx: 6.5, cy: 6.5, r: 4.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
    svg('path', {
      d: 'M10 10l4.5 4.5',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
    }),
  )

/** The picture over a tab's word in the phone's tab bar; the word names the tab, so this is decoration. */
const tabGlyph = (glyph: TabGlyph): SVGElement =>
  svg(
    'svg',
    {
      class: 'tab-glyph',
      viewBox: '0 0 16 16',
      width: 20,
      height: 20,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    svg('path', {
      d: TAB_GLYPHS[glyph],
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  )

const TAB_GLYPHS: Readonly<Record<TabGlyph, string>> = {
  notes: 'M2 2.5h12v8.5H7.5L4 14v-3H2z',
  agent: 'M3 5.5h10v8H3zM8 2v3.5M6 9.5v.5M10 9.5v.5',
  people:
    'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5M11 3a2 2 0 0 1 0 4M12 9.5c1.6.4 2.5 1.8 2.5 4.5',
  channels: 'M6.5 2 5 14M11 2 9.5 14M2.5 5.5h11M2 10.5h11',
  debates: 'M1.5 2h8v6H5l-2.5 2V8h-1zM12 5.5h2.5v6h-1V14l-2.5-2.5H7v-1.5',
}

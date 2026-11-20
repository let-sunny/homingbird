import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h, region } from '@homingbird/ui'
import { peopleConversations } from '../channels.ts'
import { connectionShown } from '../connection-status.ts'
import { featureOn } from '../features.ts'
import { memberAvatarOf } from '../models/avatar.ts'
import { logoOf, wordmark } from '../models/branding.ts'
import {
  type ConversationRow,
  type SidebarModel,
  paneFor,
  sidebarModel,
  tabsModel,
  userMenuModel,
} from '../models/shell.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { reviewsWaiting } from './channel-agent.ts'
import { renderAvatar, renderGroupAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { startingPoints } from './home.ts'
import { archivedMark, channelCounts, empty, loading, presenceBadges, timeLabel } from './parts.ts'

/** The app around a page: the header with its tabs, the connection, the sidebar and the user menu. */
export const shell = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  stage: HTMLElement,
): HTMLElement => {
  const { state } = context
  const app = h(
    'div',
    { class: 'app' },
    titleBar(context, life, me),
    connectionNotice(context, life),
    sidebar(context, life, me),
    stage,
  )
  const showPane = (): void => {
    app.dataset.pane = paneFor(state.route.get())
  }
  showPane()
  life.add(state.route.subscribe(showPane))
  return h('div', { class: 'viewport' }, app, userMenu(context, me))
}

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
  return h(
    'header',
    { class: 'titlebar' },
    h(
      'a',
      { class: 'brand', href: '#/', 'aria-label': branding.name },
      h('img', { class: 'mark', src: logoOf(branding.logo), alt: '', width: '32', height: '32' }),
      h('span', { class: 'wordmark' }, wordmark(branding.name)),
    ),
    region(
      life,
      [state.route],
      () =>
        h(
          'nav',
          { class: 'tabs', 'aria-label': strings.sections },
          tabsModel(state.route.get(), state.serverInfo.get()).map((tab) =>
            h(
              'a',
              {
                href: tab.href,
                class: 'tab',
                'aria-current': tab.current && 'page',
                ...(tab.tour !== null && { data: { tour: tab.tour } }),
              },
              tab.label,
            ),
          ),
        ),
      { class: 'tabs-host' },
    ),
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
            data: { noticeable: String(shown.noticeable), whenShort: shown.whenShort },
          },
          h('span', { class: 'connection-mark', 'aria-hidden': 'true' }),
          h('span', { class: 'connection-label', 'aria-hidden': 'true' }, shown.label),
        )
      },
      { class: 'connection-host' },
    ),
    region(
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
    ),
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

const sidebar = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state } = context
  const model = (withArrivals = false): SidebarModel => {
    const conversations = state.conversations.get()
    return sidebarModel({
      me,
      route: state.route.get(),
      conversations,
      loaded: state.conversationsLoaded.get(),
      members: state.members.get(),
      directory: state.directory.get(),
      channels: state.channels.get(),
      agentCount: state.agentCredentials.get().length,
      charactersOn: featureOn('characters', state.serverInfo.get()),
      now: context.clock.now(),
      arrived: new Set(
        withArrivals
          ? peopleConversations(conversations)
              .filter((conversation) => context.justArrived(conversation, me.member.id))
              .map((conversation) => conversation.id)
          : [],
      ),
    })
  }
  return h(
    'aside',
    { class: 'sidebar', 'aria-label': strings.conversations },
    region(life, [state.agentCredentials, state.session], () => model().onboarding && onboarding(), {
      class: 'onboarding-host',
    }),
    reviewsWaiting(context, life),
    h('h2', { class: 'sidebar-title', data: { tour: 'notes' } }, strings.conversations),
    region(
      life,
      [state.conversations, state.members, state.directory, state.route, state.conversationsLoaded],
      () => {
        const people = model(true).people
        if (people.kind === 'loading') return loading()
        if (people.kind === 'none')
          return h(
            'div',
            { class: 'no-conversations' },
            h('p', { class: 'no-conversations-text' }, strings.noConversations),
            startingPoints(context),
          )
        return h(
          'ul',
          { class: 'conversation-list' },
          people.rows.map((row) => conversationRow(context, row)),
        )
      },
      { class: 'conversations-host' },
    ),
    h(
      'div',
      { class: 'sidebar-section-head' },
      h('h2', { class: 'sidebar-title' }, strings.channels),
      h('a', { class: 'browse-channels', href: hrefFor({ name: 'channels' }) }, strings.browseChannels),
    ),
    region(life, [state.conversations, state.route, state.channels], () => {
      const rooms = model().channelRooms
      return rooms.length === 0
        ? empty(strings.noChannelRooms)
        : h(
            'ul',
            { class: 'conversation-list channel-rooms' },
            rooms.map((row) => conversationRow(context, row)),
          )
    }),
    region(life, [state.conversations, state.route, state.members], () => {
      const archived = model().archived
      return (
        archived !== null &&
        h(
          'details',
          { class: 'archived-rooms', open: archived.open },
          h('summary', { class: 'sidebar-title' }, archived.title),
          h(
            'ul',
            { class: 'conversation-list' },
            archived.rows.map((row) => conversationRow(context, row)),
          ),
        )
      )
    }),
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

const conversationRow = (context: ViewContext, row: ConversationRow): HTMLElement =>
  h(
    'li',
    {},
    h(
      'a',
      { class: 'conversation', href: row.href, 'aria-current': row.current && 'page' },
      row.face.kind === 'channel'
        ? h('span', { class: 'avatar is-channel', 'aria-hidden': 'true' }, '#')
        : row.face.kind === 'group'
          ? renderGroupAvatar(context, row.face.faces)
          : renderAvatar(context, row.face.avatar),
      h(
        'span',
        { class: 'conversation-main' },
        h(
          'span',
          { class: 'conversation-name' },
          row.title,
          row.presence !== null && presenceBadges(row.presence),
          row.archived && archivedMark(),
        ),
        row.channel !== null && h('span', { class: 'conversation-counts' }, channelCounts(row.channel)),
        h('span', { class: 'conversation-preview' }, row.preview),
      ),
      h(
        'span',
        { class: 'conversation-side' },
        row.time !== null && timeLabel(row.time),
        row.unread !== null &&
          h('span', { class: 'count unread', 'aria-label': row.unread.label }, row.unread.count),
        row.drafts !== null &&
          h('span', { class: 'count drafts', 'aria-label': row.drafts.label }, row.drafts.text),
      ),
    ),
  )

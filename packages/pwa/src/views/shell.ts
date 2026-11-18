import { systemClock } from '@homingbird/kernel'
import type { Conversation, Me, MemberId } from '@homingbird/protocol'
import { type Lifetime, h, region } from '@homingbird/ui'
import { launch, signOut } from '../actions.ts'
import { arrivalTracker } from '../arrivals.ts'
import { archivedRooms, channelOfRoom, channelRooms, peopleConversations } from '../channels.ts'
import { connectionShown } from '../connection-status.ts'
import { type Route, hrefFor } from '../routes.ts'
import { spriteOwner } from '../sprite-owner.ts'
import {
  agentCredentials,
  branding,
  channels,
  connection,
  conversations,
  conversationsLoaded,
  directory,
  members,
  route,
  session,
} from '../state.ts'
import { strings } from '../strings.ts'
import { conversationTitle, excerpt, otherParticipants } from '../thread.ts'
import { groupAvatar, memberAvatar } from './character-avatar.ts'
import { startingPoints } from './home.ts'
import { archivedMark, channelCounts, emptyWithPip, presenceBadges, timeLabel, wordmark } from './parts.ts'
import { pip } from './pip.ts'

export const shell = (life: Lifetime, me: Me, stage: HTMLElement): HTMLElement => {
  const app = h('div', { class: 'app' }, titleBar(life, me), connectionNotice(life), sidebar(life, me), stage)
  const showPane = (): void => {
    app.dataset.pane = route.get().name === 'home' ? 'list' : 'stage'
  }
  showPane()
  life.add(route.subscribe(showPane))
  return h('div', { class: 'viewport' }, app, userMenu(me))
}

const USER_MENU_ID = 'user-menu'

const connectionNotice = (life: Lifetime): HTMLElement =>
  region(
    life,
    [connection],
    () => {
      const shown = connectionShown(connection.get(), strings)
      return shown.state === 'offline' && h('p', { class: 'connection-notice' }, shown.description)
    },
    { class: 'connection-notice-host' },
  )

const titleBar = (life: Lifetime, me: Me): HTMLElement =>
  h(
    'header',
    { class: 'titlebar' },
    h(
      'a',
      { class: 'brand', href: '#/' },
      h('img', {
        class: 'mark',
        src: branding.get().logo ?? '/icons/mark.svg',
        alt: '',
        width: '32',
        height: '32',
      }),
      h('span', { class: 'wordmark' }, wordmark(branding.get().name)),
    ),
    region(
      life,
      [route],
      () =>
        h(
          'nav',
          { class: 'tabs', 'aria-label': strings.sections },
          tab(strings.navNotes, { name: 'home' }, ['home', 'conversation']),
          tab(strings.navPeople, { name: 'people' }, ['people']),
          tab(strings.channels, { name: 'channels' }, ['channels', 'channel'], 'channels'),
          tab(strings.navSearch, { name: 'search', query: '' }, ['search']),
        ),
      { class: 'tabs-host' },
    ),
    region(life, [connection], () => {
      const shown = connectionShown(connection.get(), strings)
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
    }),
    region(
      life,
      [members],
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
          memberAvatar(members.get().get(me.member.id) ?? me.member, { labelled: false }),
        ),
      { class: 'user-button-host' },
    ),
  )

const tab = (
  label: string,
  target: Route,
  activeFor: ReadonlyArray<Route['name']>,
  tour?: string,
): HTMLElement =>
  h(
    'a',
    {
      href: hrefFor(target),
      class: 'tab',
      'aria-current': activeFor.includes(route.get().name) && 'page',
      ...(tour !== undefined && { data: { tour } }),
    },
    label,
  )

const userMenu = (me: Me): HTMLElement =>
  h(
    'div',
    { id: USER_MENU_ID, popover: 'auto', class: 'menu' },
    h('p', { class: 'menu-who' }, h('strong', {}, me.member.name), h('span', {}, me.member.email)),
    menuLink(strings.menuProfile, { name: 'profile' }),
    menuLink(strings.menuCredentials, { name: 'credentials' }),
    menuLink(strings.connectAgent, { name: 'connect' }),
    me.member.role === 'admin' && menuLink(strings.menuAdmin, { name: 'admin', section: 'settings' }),
    h(
      'button',
      { type: 'button', class: 'menu-item', on: { click: () => launch(signOut) } },
      strings.menuSignOut,
    ),
  )

const menuLink = (label: string, target: Route): HTMLElement =>
  h(
    'a',
    {
      class: 'menu-item',
      href: hrefFor(target),
      on: { click: () => document.getElementById(USER_MENU_ID)?.hidePopover() },
    },
    label,
  )

const sidebar = (life: Lifetime, me: Me): HTMLElement =>
  h(
    'aside',
    { class: 'sidebar', 'aria-label': strings.conversations },
    region(life, [agentCredentials, session], () => agentCredentials.get().length === 0 && onboarding(), {
      class: 'onboarding-host',
    }),
    h('h2', { class: 'sidebar-title', data: { tour: 'notes' } }, strings.conversations),
    region(
      life,
      [conversations, members, directory, route, conversationsLoaded],
      () => {
        const people = peopleConversations(conversations.get())
        if (!conversationsLoaded.get()) return h('p', { class: 'loading' }, strings.loading)
        return people.length === 0
          ? h(
              'div',
              { class: 'no-conversations' },
              h('p', { class: 'no-conversations-text' }, strings.noConversations),
              startingPoints(),
            )
          : h(
              'ul',
              { class: 'conversation-list' },
              people.map((conversation) => conversationRow(conversation, me)),
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
    region(life, [conversations, route, channels], () => {
      const rooms = channelRooms(conversations.get())
      return rooms.length === 0
        ? emptyWithPip(
            'searching',
            3,
            strings.noChannelRooms,
            h('a', { class: 'button', href: hrefFor({ name: 'channels' }) }, strings.browseChannels),
          )
        : h(
            'ul',
            { class: 'conversation-list channel-rooms' },
            rooms.map((conversation) => conversationRow(conversation, me)),
          )
    }),
    region(life, [conversations, route, members], () => {
      const archived = archivedRooms(conversations.get())
      return (
        archived.length > 0 &&
        h(
          'details',
          { class: 'archived-rooms', open: archived.some(isOpenRoom) },
          h('summary', { class: 'sidebar-title' }, strings.archivedGroup({ count: archived.length })),
          h(
            'ul',
            { class: 'conversation-list' },
            archived.map((conversation) => conversationRow(conversation, me)),
          ),
        )
      )
    }),
  )

const isOpenRoom = (conversation: Conversation): boolean => {
  const current = route.get()
  return current.name === 'conversation' && current.id === conversation.id
}

const onboarding = (): HTMLElement =>
  h(
    'div',
    { class: 'onboarding', role: 'note' },
    pip('sign-in', 2),
    h(
      'div',
      { class: 'onboarding-text' },
      h('strong', {}, strings.onboardingTitle),
      h('p', {}, strings.onboardingHint),
      h(
        'a',
        { class: 'button primary', href: hrefFor({ name: 'connect' }), data: { tour: 'connect' } },
        strings.connectAgent,
      ),
    ),
  )

const justArrived = arrivalTracker(systemClock.now(), () => systemClock.now())

const conversationFace = (
  conversation: Conversation,
  me: Me,
  others: ReadonlyArray<MemberId>,
  arrived: boolean,
): HTMLElement => {
  const people = others.map((id) => members.get().get(id))
  if (conversation.kind !== 'direct' && people.length > 1) return groupAvatar(people)
  const owner = spriteOwner({
    kind: 'conversation',
    viewerId: me.member.id,
    participantIds: conversation.participantIds,
    arrivedFrom: arrived ? (conversation.lastNote?.authorId ?? null) : null,
  }) as MemberId
  return memberAvatar(members.get().get(owner), {
    labelled: false,
    ...(arrived && { state: 'new-note', motion: 'once' }),
  })
}

const conversationRow = (conversation: Conversation, me: Me): HTMLElement => {
  const title = conversationTitle(conversation, members.get(), me.member.id, strings.formerMember)
  const current = route.get()
  const isOpen = current.name === 'conversation' && current.id === conversation.id
  const others = otherParticipants(conversation, me.member.id)
  const presence = directory.get().find((entry) => entry.member.id === others[0])?.presence
  const archived = conversation.archivedAt !== null
  const channel = conversation.kind === 'channel' ? channelOfRoom(channels.get(), conversation.id) : null
  return h(
    'li',
    {},
    h(
      'a',
      {
        class: 'conversation',
        href: hrefFor({ name: 'conversation', id: conversation.id }),
        'aria-current': isOpen && 'page',
      },
      conversation.kind === 'channel' || archived
        ? h('span', { class: 'avatar is-channel', 'aria-hidden': 'true' }, '#')
        : conversationFace(conversation, me, others, justArrived(conversation, me.member.id)),
      h(
        'span',
        { class: 'conversation-main' },
        h(
          'span',
          { class: 'conversation-name' },
          title,
          conversation.kind === 'direct' && presence !== undefined && presenceBadges(presence),
          archived && archivedMark(),
        ),
        channel !== null && h('span', { class: 'conversation-counts' }, channelCounts(channel)),
        h(
          'span',
          { class: 'conversation-preview' },
          conversation.lastNote !== null
            ? excerpt(conversation.lastNote.body, 60)
            : conversation.draftCount > 0
              ? strings.draftsWaiting({ count: conversation.draftCount })
              : strings.noNotesYet,
        ),
      ),
      h(
        'span',
        { class: 'conversation-side' },
        conversation.lastNote?.sentAt != null && timeLabel(conversation.lastNote.sentAt),
        conversation.unreadCount > 0 && pip('new-note', 1),
        conversation.unreadCount > 0 &&
          h(
            'span',
            { class: 'count unread', 'aria-label': strings.unread({ count: conversation.unreadCount }) },
            conversation.unreadCount,
          ),
        conversation.draftCount > 0 &&
          h(
            'span',
            {
              class: 'count drafts',
              'aria-label': strings.draftsWaiting({ count: conversation.draftCount }),
            },
            `✎${conversation.draftCount}`,
          ),
      ),
    ),
  )
}

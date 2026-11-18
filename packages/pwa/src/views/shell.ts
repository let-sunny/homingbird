import type { Conversation, Me } from '@homingbird/protocol'
import { type Lifetime, h, region } from '@homingbird/ui'
import { launch, signOut } from '../actions.ts'
import { type Route, hrefFor } from '../routes.ts'
import {
  type Connection,
  agentCredentials,
  branding,
  connection,
  conversations,
  directory,
  members,
  route,
  session,
} from '../state.ts'
import { strings } from '../strings.ts'
import { conversationTitle, excerpt, otherParticipants } from '../thread.ts'
import { peopleConversations, topicRooms } from '../topics.ts'
import { avatar, emptyWithPip, presenceBadges, timeLabel, wordmark } from './parts.ts'
import { type PipState, pip } from './pip.ts'

export const shell = (life: Lifetime, me: Me, stage: HTMLElement): HTMLElement => {
  const app = h('div', { class: 'app' }, titleBar(life, me), sidebar(life, me), stage)
  const showPane = (): void => {
    app.dataset.pane = route.get().name === 'home' ? 'list' : 'stage'
  }
  showPane()
  life.add(route.subscribe(showPane))
  return h('div', { class: 'viewport' }, app, userMenu(me))
}

const USER_MENU_ID = 'user-menu'

const CONNECTION_PIP: Readonly<Record<Connection, PipState>> = {
  connecting: 'connecting',
  live: 'idle',
  polling: 'idle',
  offline: 'disconnected',
}

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
          tab(strings.topics, { name: 'topics' }, ['topics', 'topic']),
          tab(strings.navSearch, { name: 'search', query: '' }, ['search']),
        ),
      { class: 'tabs-host' },
    ),
    region(life, [connection], () =>
      h(
        'span',
        { class: `connection is-${connection.get()}`, role: 'status' },
        pip(CONNECTION_PIP[connection.get()], 1),
        h('span', {}, strings.connection[connection.get()]),
      ),
    ),
    h(
      'button',
      { type: 'button', class: 'user-button', popovertarget: USER_MENU_ID, 'aria-label': strings.menu },
      avatar(me.member.name),
    ),
  )

const tab = (label: string, target: Route, activeFor: ReadonlyArray<Route['name']>): HTMLElement =>
  h(
    'a',
    { href: hrefFor(target), class: 'tab', 'aria-current': activeFor.includes(route.get().name) && 'page' },
    label,
  )

const userMenu = (me: Me): HTMLElement =>
  h(
    'div',
    { id: USER_MENU_ID, popover: 'auto', class: 'menu' },
    h('p', { class: 'menu-who' }, h('strong', {}, me.member.name), h('span', {}, me.member.email)),
    menuLink(strings.menuProfile, { name: 'profile' }),
    menuLink(strings.menuCredentials, { name: 'credentials' }),
    menuLink(strings.menuConnectDevice, { name: 'device', code: null }),
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
    h('h2', { class: 'sidebar-title' }, strings.conversations),
    region(life, [conversations, members, directory, route], () => {
      const people = peopleConversations(conversations.get())
      return people.length === 0
        ? emptyWithPip(
            'waving',
            3,
            strings.noConversations,
            h('a', { class: 'button', href: '#/people' }, strings.findPeople),
          )
        : h(
            'ul',
            { class: 'conversation-list' },
            people.map((conversation) => conversationRow(conversation, me)),
          )
    }),
    h(
      'div',
      { class: 'sidebar-section-head' },
      h('h2', { class: 'sidebar-title' }, strings.topics),
      h('a', { class: 'browse-topics', href: hrefFor({ name: 'topics' }) }, strings.browseTopics),
    ),
    region(life, [conversations, route], () => {
      const rooms = topicRooms(conversations.get())
      return rooms.length === 0
        ? h('p', { class: 'sidebar-empty' }, strings.noTopicRooms)
        : h(
            'ul',
            { class: 'conversation-list topic-rooms' },
            rooms.map((conversation) => conversationRow(conversation, me)),
          )
    }),
  )

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
        { class: 'button primary', href: hrefFor({ name: 'device', code: null }) },
        strings.connectAgent,
      ),
    ),
  )

const conversationRow = (conversation: Conversation, me: Me): HTMLElement => {
  const title = conversationTitle(conversation, members.get(), me.member.id, strings.formerMember)
  const current = route.get()
  const isOpen = current.name === 'conversation' && current.id === conversation.id
  const others = otherParticipants(conversation, me.member.id)
  const presence = directory.get().find((entry) => entry.member.id === others[0])?.presence
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
      conversation.kind === 'topic'
        ? h('span', { class: 'avatar is-topic', 'aria-hidden': 'true' }, '#')
        : avatar(title),
      h(
        'span',
        { class: 'conversation-main' },
        h(
          'span',
          { class: 'conversation-name' },
          title,
          conversation.kind === 'dm' && presence !== undefined && presenceBadges(presence),
        ),
        h(
          'span',
          { class: 'conversation-preview' },
          conversation.lastNote !== null
            ? excerpt(conversation.lastNote.body, 60)
            : conversation.draftCount > 0
              ? strings.draftsWaiting(conversation.draftCount)
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
            { class: 'count unread', 'aria-label': strings.unread(conversation.unreadCount) },
            conversation.unreadCount,
          ),
        conversation.draftCount > 0 &&
          h(
            'span',
            { class: 'count drafts', 'aria-label': strings.draftsWaiting(conversation.draftCount) },
            `✎${conversation.draftCount}`,
          ),
      ),
    ),
  )
}

import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { shell } from '../../src/views/shell.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import {
  ANA,
  BEN,
  CY,
  ROOM,
  channel,
  conversation,
  credential,
  draft,
  entry,
  me,
  member,
  note,
} from '../support/fixtures.ts'
import { heldDecision } from '../support/held.ts'

usingFakeDom()

describe('shell', () => {
  it('shows the header, the user menu, the list and the page, the list alone on home', () => {
    const { context, called } = testContext()
    context.state.session.set(me())
    const stage = document.createElement('main')
    const shown = mount(shell(context, lifetime(), me(), stage))
    const app = shown.querySelector('.app') as HTMLElement
    expect(app.dataset.pane).toBe('list')
    context.state.route.set({ name: 'people' })
    expect(app.dataset.pane).toBe('stage')
    expect(getByRole(shown, 'link', { name: strings.navPeople }).getAttribute('aria-current')).toBe('page')
    getByRole(shown, 'button', { name: strings.menu }).click()
    getByRole(shown, 'link', { name: strings.menuProfile }).click()
    expect(queryByRole(shown, 'link', { name: strings.menuProfile })).toBeNull()
    getByRole(shown, 'button', { name: strings.menu }).click()
    getByRole(shown, 'button', { name: strings.menuSignOut }).click()
    expect(called('signOut')).toHaveLength(1)
    expect(textOf(shown)).toContain(strings.loading)
  })

  it('gives each tab a word under a hidden glyph, and hides the phone’s tab bar in a conversation', () => {
    const { context } = testContext()
    context.state.session.set(me())
    const shown = mount(shell(context, lifetime(), me(), document.createElement('main')))
    const app = shown.querySelector('.app') as HTMLElement
    const tabs = [...shown.querySelectorAll('.tabs .tab')]
    expect(tabs.map((tab) => textOf(tab.querySelector('.tab-label')!))).toEqual([
      strings.navNotes,
      strings.navMyAgent,
      strings.navPeople,
      strings.channels,
      strings.navDebates,
    ])
    expect(
      tabs.every((tab) => tab.querySelector('svg.tab-glyph')?.getAttribute('aria-hidden') === 'true'),
    ).toBe(true)
    expect(getByRole(shown, 'link', { name: strings.navNotes }).getAttribute('aria-current')).toBe('page')
    expect(app.dataset.tabBar).toBe('shown')
    context.state.route.set({ name: 'conversation', id: ROOM, draft: null })
    expect(app.dataset.tabBar).toBe('hidden')
    context.state.route.set({ name: 'channels' })
    expect(app.dataset.tabBar).toBe('shown')
  })

  it('offers, in a conversation, a first link that skips to writing a note', () => {
    const { context } = testContext()
    context.state.session.set(me())
    const shown = mount(shell(context, lifetime(), me(), document.createElement('main')))
    expect(queryByRole(shown, 'button', { name: strings.skipToComposer })).toBeNull()
    context.state.route.set({ name: 'conversation', id: ROOM, draft: null })
    const skip = getByRole(shown, 'button', { name: strings.skipToComposer })
    expect(shown.children[0]!.contains(skip)).toBe(true)
    const composer = mount(document.createElement('form'))
    composer.className = 'composer'
    const field = composer.appendChild(document.createElement('textarea'))
    skip.click()
    expect(document.activeElement).toBe(field)
  })

  it('offers search beside the bell and scrolls the current tab into the tab row', () => {
    const { context, page } = testContext()
    context.state.session.set(me())
    const shown = mount(shell(context, lifetime(), me(), document.createElement('main')))
    const search = getByRole(shown, 'link', { name: strings.search })
    expect(search.closest('.header-actions')).not.toBeNull()
    expect(search.getAttribute('href')).toBe('#/search?q=')
    expect(queryByRole(shown.querySelector('.tabs')!, 'link', { name: strings.navSearch })).toBeNull()
    context.state.route.set({ name: 'search', query: '' })
    expect(getByRole(shown, 'link', { name: strings.search }).getAttribute('aria-current')).toBe('page')
    context.state.route.set({ name: 'channels' })
    const nav = shown.querySelector<HTMLElement>('.tabs')!
    const current = getByRole(nav, 'link', { name: strings.channels })
    measure(nav, { offsetLeft: 0, clientWidth: 100, scrollLeft: 0 })
    measure(current, { offsetLeft: 250, offsetWidth: 60 })
    page.runFrames()
    expect(nav.scrollLeft).toBe(210)
    context.state.route.set({ name: 'home' })
    const back = shown.querySelector<HTMLElement>('.tabs')!
    measure(back, { offsetLeft: 0, clientWidth: 100, scrollLeft: 200 })
    measure(getByRole(back, 'link', { name: strings.navNotes }), { offsetLeft: 0, offsetWidth: 50 })
    page.runFrames()
    expect(back.scrollLeft).toBe(0)
    const later = shown.querySelector<HTMLElement>('.tabs-scroll.is-later')!
    expect([later.getAttribute('aria-hidden'), later.getAttribute('tabindex')]).toEqual(['true', '-1'])
    later.click()
    expect(back.scrollLeft).toBe(75)
    shown.querySelector<HTMLElement>('.tabs-scroll.is-earlier')!.click()
    expect(back.scrollLeft).toBe(0)
  })

  it('mutes a row and leaves a channel from the row’s menu, or says why the person cannot leave', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    context.state.session.set(me())
    context.state.directory.set([entry(BEN, 'Ben')])
    const billing = channel('billing', { joined: true })
    const ops = channel('ops', { joined: true, managing: true })
    context.state.channels.set([billing, ops])
    const shown = mount(shell(context, lifetime(), me(), document.createElement('main')))
    context.state.conversations.set([
      conversation(),
      conversation({ id: billing.conversationId, kind: 'channel', title: 'billing' }),
      conversation({ id: ops.conversationId, kind: 'channel', title: 'ops' }),
    ])
    context.state.conversationsLoaded.set(true)
    const rows = [...shown.querySelectorAll<HTMLElement>('.conversation-item')]
    getByRole(rows[0]!, 'button', { name: strings.conversationMore({ name: 'Ben' }) }).click()
    getByRole(rows[0]!, 'menuitem', { name: strings.mute.muteName({ name: 'Ben' }) }).click()
    expect(called('setMuted')[0]!.args).toEqual([ROOM, true])
    expect(fire.event(rows[1]!.querySelector('.conversation-title'), 'contextmenu')).toBe(false)
    getByRole(rows[1]!, 'menuitem', { name: strings.leaveChannel }).click()
    const dialog = document.getElementById('dialog') as HTMLDialogElement
    expect(dialog.open).toBe(true)
    fire.submit(dialog.querySelector('form')!)
    expect(called('leaveChannel')[0]!.args).toEqual(['billing'])
    context.state.reviews.set([
      {
        note: draft('note_waiting', { conversationId: billing.conversationId }),
        question: note('note_question'),
        channel: 'billing',
        agent: member(CY, 'Billing helper'),
        privately: false,
      },
    ])
    const billingRow = [...shown.querySelectorAll<HTMLElement>('.conversation-item')][1]!
    expect(billingRow.querySelector('.count.reviews')!.getAttribute('aria-label')).toBe(
      strings.channelAgent.reviewBadgeLabel({ count: 1 }),
    )
    expect(billingRow.querySelector('a')!.getAttribute('href')).toContain('?review=note_waiting')
    context.state.held.set([heldDecision('note_waiting', { review: true, settles: 0 })])
    expect(
      [...shown.querySelectorAll<HTMLElement>('.conversation-item')][1]!.querySelector('.count.reviews'),
    ).toBeNull()
    context.state.held.set([])
    fire.event(rows[2]!, 'contextmenu')
    const blocked = getByRole(rows[2]!, 'menuitem', { name: strings.leaveChannel }) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    expect(document.getElementById(blocked.getAttribute('aria-describedby')!)!.textContent).toBe(
      strings.managerCannotLeave,
    )
  })

  it('marks the My agent tab while the person’s agent cannot answer, and clears it once it can', () => {
    const { context } = testContext()
    context.state.session.set(me())
    const shown = mount(shell(context, lifetime(), me(), document.createElement('main')))
    const tab = () => shown.querySelector('.tabs .tab[data-tour="connect"]')!
    expect(tab().querySelector('.agent-mark')).toBeNull()
    context.state.directory.set([
      entry(ANA, 'Ana', {
        presence: { humanOnline: true, agentOnline: true, agentUnavailable: { until: null, kind: 'failed' } },
      }),
    ])
    expect(getByRole(tab() as HTMLElement, 'img', { name: strings.activity.unavailableTitle })).toBeTruthy()
    context.state.directory.set([entry(ANA, 'Ana')])
    expect(tab().querySelector('.agent-mark')).toBeNull()
  })

  it('says how it is connected, and tells when it is offline', () => {
    const { context } = testContext()
    const shown = shell(context, lifetime(), me(), document.createElement('main'))
    expect(getByRole(shown, 'status', { name: strings.connection.connecting })).toBeTruthy()
    context.state.connection.set('offline')
    expect(textOf(shown)).toContain(strings.connectionOffline)
  })

  it('offers the first steps without conversations, then invites connecting an agent beside them', () => {
    const { context } = testContext()
    const shown = shell(context, lifetime(), me(), document.createElement('main'))
    context.state.conversationsLoaded.set(true)
    expect(shown.querySelector('.onboarding')).toBeNull()
    expect(textOf(shown)).toContain(strings.noConversations)
    expect(textOf(shown.querySelector('.starting-points')!)).toContain(strings.start.connectStep)
    context.state.conversations.set([conversation()])
    expect(textOf(shown)).toContain(strings.onboardingTitle)
    context.state.agentCredentials.set([credential('cred_desk')])
    expect(shown.querySelector('.onboarding')).toBeNull()
    expect(textOf(shown)).toContain(strings.noChannelRooms)
  })

  it('redraws only the row whose conversation changed when the list is loaded again', () => {
    const { context } = testContext()
    context.state.session.set(me())
    context.state.directory.set([entry(BEN, 'Ben'), entry(CY, 'Cy')])
    const billing = channel('billing')
    context.state.channels.set([billing])
    const shown = shell(context, lifetime(), me(), document.createElement('main'))
    const listed = (preview: string) => [
      conversation({ lastNote: note('n1', { body: preview }) }),
      conversation({ id: 'conv_cy0000000000' as never, participantIds: [CY, me().member.id] }),
      conversation({ id: billing.conversationId, kind: 'channel', title: 'billing' }),
      conversation({ id: 'conv_old000000000' as never, kind: 'channel', title: 'old', archivedAt: 5 }),
    ]
    context.state.conversationsLoaded.set(true)
    context.state.conversations.set(listed('Hello'))
    const before = [...shown.querySelectorAll('.conversation-item')]
    const lists = [...shown.querySelectorAll('.conversation-list')]
    expect(before).toHaveLength(4)
    context.state.conversations.set(listed('Hello again'))
    const after = [...shown.querySelectorAll('.conversation-item')]
    expect([...shown.querySelectorAll('.conversation-list')]).toEqual(lists)
    expect(after.map((row, index) => row === before[index])).toEqual([false, true, true, true])
    expect(after[0]!.textContent).toContain('Hello again')
  })

  it('shows only what waits for the person while Waiting for you is pressed, and opens the switcher on Ctrl+K', () => {
    const { context, page } = testContext()
    context.state.session.set(me())
    const shown = mount(shell(context, lifetime(), me(), document.createElement('main')))
    const asked = note('note_q', { body: 'Lunch?' })
    context.state.conversations.set([
      conversation({ lastNote: asked }),
      conversation({
        id: 'conv_quiet0000000' as never,
        participantIds: [me().member.id, CY],
        lastNote: note('n9', { body: 'Quiet' }),
      }),
    ])
    context.state.conversationsLoaded.set(true)
    context.state.threads.set(
      new Map([[ROOM, { notes: [asked, draft('note_d1', { inReplyTo: asked.id })], hasMore: false }]]),
    )
    const filter = getByRole(shown, 'button', { name: /Waiting for you/ })
    expect(filter.getAttribute('aria-pressed')).toBe('false')
    expect(filter.getAttribute('title')).toBe(strings.waiting.filterLabel({ count: 1 }))
    expect(getByRole(shown, 'link', { name: /Quiet/ })).toBeTruthy()
    filter.click()
    expect(getByRole(shown, 'button', { name: /Waiting for you/ }).getAttribute('aria-pressed')).toBe('true')
    expect(queryByRole(shown, 'link', { name: /Quiet/ })).toBeNull()
    expect(getByRole(shown, 'link', { name: /Lunch/ })).toBeTruthy()
    expect(textOf(shown)).toContain(strings.waiting.roomsNone)
    context.state.threads.set(new Map())
    context.state.conversations.set([conversation({ id: 'conv_quiet0000000' as never })])
    expect(textOf(shown)).toContain(strings.waiting.peopleNone)
    expect(page.outside.title).toBe('Homingbird')
    fire.key(document.body, 'k', { ctrlKey: true })
    expect((shown.querySelector('dialog.switcher') as HTMLDialogElement).open).toBe(true)
  })

  it('lists direct messages, groups, channel rooms and archived rooms, each with its counts', () => {
    const { context } = testContext()
    context.state.session.set(me())
    context.state.directory.set([
      entry(BEN, 'Ben', { presence: { humanOnline: true, agentOnline: true } }),
      entry(CY, 'Cy'),
    ])
    const billing = channel('billing')
    context.state.channels.set([billing])
    const shown = shell(context, lifetime(), me(), document.createElement('main'))
    context.state.conversations.set([
      conversation({
        lastNote: note('n1', { body: 'Hello', sentAt: context.clock.now() }),
        unreadCount: 2,
        draftCount: 1,
      }),
      conversation({
        id: 'conv_group0000000' as never,
        kind: 'group',
        title: 'Team',
        participantIds: [BEN, CY, me().member.id],
      }),
      conversation({ id: billing.conversationId, kind: 'channel', title: 'billing' }),
      conversation({ id: 'conv_old000000000' as never, kind: 'channel', title: 'old', archivedAt: 5 }),
    ])
    context.state.conversationsLoaded.set(true)
    context.state.route.set({ name: 'conversation', id: ROOM, draft: null })
    const row = getByRole(shown, 'link', { name: /Hello/ })
    expect(row.getAttribute('aria-current')).toBe('page')
    expect(getByRole(row, 'img', { name: strings.humanOnline })).toBeTruthy()
    expect(row.querySelector('.conversation-face > .agent-dot')!.getAttribute('aria-label')).toBe(
      strings.agentOnline,
    )
    expect(row.querySelector('.conversation-title')!.getAttribute('title')).toBe('Ben')
    expect(row.querySelector('.count.unread')!.getAttribute('aria-label')).toBe(strings.unread({ count: 2 }))
    expect(row.querySelector('.count.drafts')!.firstChild!.textContent).toBe('✎1')
    expect(row.querySelector('.count.drafts .count-word')!.textContent).toBe(
      strings.draftsShort({ count: 1 }),
    )
    expect(row.querySelector('.count.drafts')!.getAttribute('title')).toBe(
      strings.draftsWaiting({ count: 1 }),
    )
    context.state.held.set([heldDecision('d1')])
    expect(getByRole(shown, 'link', { name: /Hello/ }).querySelector('.count.drafts')).toBeNull()
    context.state.held.set([])
    expect(shown.querySelector('.character-group')).not.toBeNull()
    expect(textOf(shown.querySelector('.channel-rooms')!)).toContain('#billing')
    expect(textOf(shown.querySelector('.archived-rooms')!)).toContain(strings.archivedGroup({ count: 1 }))
    expect(row.querySelector('.typed-mark')).toBeNull()
    context.state.composerTexts.set(new Map([[ROOM, 'Half a thought']]))
    const typed = getByRole(shown, 'link', { name: /Hello/ }).querySelector('.typed-mark')!
    expect([typed.textContent, typed.getAttribute('aria-label')]).toEqual(['✎', strings.unsentText])
  })
})

const measure = (element: HTMLElement, sizes: Readonly<Record<string, number>>): void => {
  for (const [name, value] of Object.entries(sizes))
    Object.defineProperty(element, name, { value, configurable: true, writable: true })
}

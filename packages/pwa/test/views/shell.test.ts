import { lifetime } from '@homingbird/ui'
import { getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { shell } from '../../src/views/shell.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { BEN, CY, ROOM, channel, conversation, credential, entry, me, note } from '../support/fixtures.ts'

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

  it('says how it is connected, and tells when it is offline', () => {
    const { context } = testContext()
    const shown = shell(context, lifetime(), me(), document.createElement('main'))
    expect(getByRole(shown, 'status', { name: strings.connection.connecting })).toBeTruthy()
    context.state.connection.set('offline')
    expect(textOf(shown)).toContain(strings.connectionOffline)
  })

  it('invites connecting an agent, and offers where to start without conversations', () => {
    const { context } = testContext()
    const shown = shell(context, lifetime(), me(), document.createElement('main'))
    context.state.conversationsLoaded.set(true)
    expect(textOf(shown)).toContain(strings.onboardingTitle)
    expect(textOf(shown)).toContain(strings.noConversations)
    context.state.agentCredentials.set([credential('cred_desk')])
    expect(shown.querySelector('.onboarding')).toBeNull()
    expect(textOf(shown)).toContain(strings.noChannelRooms)
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
    expect(row.querySelector('.count.unread')!.getAttribute('aria-label')).toBe(strings.unread({ count: 2 }))
    expect(row.querySelector('.count.drafts')!.textContent).toBe('✎1')
    expect(shown.querySelector('.character-group')).not.toBeNull()
    expect(textOf(shown.querySelector('.channel-rooms')!)).toContain('#billing')
    expect(textOf(shown.querySelector('.archived-rooms')!)).toContain(strings.archivedGroup({ count: 1 }))
  })
})

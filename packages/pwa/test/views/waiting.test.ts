import { lifetime } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { watchWaiting } from '../../src/views/waiting.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ROOM, conversation, draft, me, note } from '../support/fixtures.ts'

usingFakeDom()

describe('watchWaiting', () => {
  it('shows what waits in the tab title and the app badge as it changes, and the plain name once signed out', () => {
    const { context, page } = testContext()
    const { state } = context
    state.branding.set({ name: 'Acme', logo: null })
    const life = lifetime()
    const waiting = watchWaiting(context, life, me())
    expect(page.outside).toEqual({ title: 'Acme', badge: null })
    state.conversations.set([conversation({ unreadCount: 2 })])
    expect(page.outside).toEqual({
      title: strings.waiting.titleUnread({ unread: 2, name: 'Acme' }),
      badge: 'unread',
    })
    const asked = note('note_q', { body: 'Lunch?' })
    state.threads.set(
      new Map([[ROOM, { notes: [asked, draft('note_d1', { inReplyTo: asked.id })], hasMore: false }]]),
    )
    expect(waiting.get()).toMatchObject({ approvals: 1, others: 0 })
    expect(page.outside).toEqual({
      title: strings.waiting.titleApproveUnread({ approve: 1, unread: 2, name: 'Acme' }),
      badge: 1,
    })
    state.branding.set({ name: 'Beta', logo: null })
    expect(page.outside.title).toBe(
      strings.waiting.titleApproveUnread({ approve: 1, unread: 2, name: 'Beta' }),
    )
    life.end()
    expect(page.outside).toEqual({ title: 'Beta', badge: null })
  })
})

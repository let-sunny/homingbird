import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { strings } from '../../src/strings.ts'
import { showApp } from '../../src/views/app-shell.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const start = (hash = '#/') => {
  const test = testContext(hash)
  const root = mount(document.createElement('div'))
  const launched = vi.fn()
  showApp(test.context, root, launched)
  return { ...test, root, launched }
}

describe('showApp', () => {
  it('waits for the session, then offers to sign in', () => {
    const { context, root } = start()
    expect(textOf(root)).toBe(strings.loading)
    context.state.session.set(null)
    expect(getByRole(root, 'link', { name: /Sign in/ })).toBeTruthy()
  })

  it('sends a person who came to connect an agent to sign in first, and says why they were signed out', () => {
    const connect = start('#/consent/consent_1')
    connect.context.state.session.set(null)
    expect(connect.page.visited.at(-1)).toMatch(/^replace \/auth\/login\?return_to=/)
    const out = start('#/signed-out?reason=domain')
    out.context.state.session.set(null)
    expect(getByRole(out.root, 'alert')).toBeTruthy()
  })

  it('shows the shell around the page the route shows, counts each page, and starts the tour on home', () => {
    const { context, root, launched, page, tour } = start()
    context.state.session.set(me())
    expect(root.querySelector('.app')).not.toBeNull()
    expect(launched).toHaveBeenCalledTimes(1)
    page.runFrames()
    expect(tour.homes).toEqual(['home'])
    context.state.route.set({ name: 'people' })
    expect(getByRole(root, 'heading', { name: strings.people })).toBeTruthy()
    expect(launched).toHaveBeenCalledTimes(2)
    context.state.serverInfo.set(serverInfo())
    expect(root.querySelector('.app')).not.toBeNull()
  })

  it('follows the address, and replaces an old one with its current form', () => {
    const { context, page } = start()
    context.state.session.set(me())
    page.state.hash = '#/people'
    page.emit('hashchange')
    expect(context.state.route.get()).toEqual({ name: 'people' })
    page.state.hash = '#/connect'
    page.emit('hashchange')
    expect(page.visited.at(-1)).toBe('replace #/agent/connection')
    page.state.reducedMotion = false
    const transition = vi.fn((change: () => void) => {
      change()
      return { ready: Promise.reject(new Error('skipped')) }
    })
    Object.assign(document, { startViewTransition: transition })
    page.state.hash = '#/channels'
    page.emit('hashchange')
    expect(transition).toHaveBeenCalled()
    expect(context.state.route.get()).toEqual({ name: 'channels' })
  })

  it('shows a page reached to connect an agent on its own, and the shell again after', () => {
    const { context, root } = start('#/consent/consent_1')
    context.state.session.set(me())
    expect(root.querySelector('.app')).toBeNull()
    context.state.route.set({ name: 'home' })
    expect(root.querySelector('.app')).not.toBeNull()
    context.state.route.set({ name: 'consent', id: 'consent_2' })
    expect(root.querySelector('.app')).toBeNull()
  })

  it('shows a notice until it is closed or its time is up, and announces arriving notes', async () => {
    const { context, root, clock } = start()
    context.state.session.set(me())
    context.state.notice.set({ kind: 'error', text: 'No.', link: { href: '#/people', label: 'Find them' } })
    expect(getByRole(root, 'alert').textContent).toContain('No.')
    getByRole(root, 'link', { name: 'Find them' }).click()
    expect(context.state.notice.get()).toBeNull()
    context.state.notice.set({ kind: 'info', text: 'Saved.' })
    getByRole(root, 'button', { name: strings.close }).click()
    expect(context.state.notice.get()).toBeNull()
    context.state.notice.set({ kind: 'info', text: 'Again.' })
    await clock.advance(6000)
    expect(context.state.notice.get()).toBeNull()
    context.state.announcement.set('A note from Ben')
    expect(textOf(root)).toContain('A note from Ben')
  })
})

import { fakePage } from '@homingbird/pwa/test/support/context.ts'
import { describe, expect, it, vi } from 'vitest'
import { demoPage } from '../src/demo-page.ts'

describe('demoPage', () => {
  it('sends every request to the demo, starts over instead of leaving, and offers no push', () => {
    const browser = fakePage()
    browser.state.push = true
    const dovecote = vi.fn(() => Promise.resolve(new Response('{}')))
    const startOver = vi.fn()
    const page = demoPage(browser.page, dovecote, startOver)
    void page.fetch('/branding.json')
    page.assign('/')
    expect(dovecote).toHaveBeenCalledWith('/branding.json')
    expect(startOver).toHaveBeenCalledTimes(1)
    expect(browser.visited).toEqual([])
    expect(page.supportsPush()).toBe(false)
    expect(page.hash()).toBe('#/')
  })
})

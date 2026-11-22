import { fakePage } from '@homingbird/pwa/test/support/context.ts'
import { describe, expect, it, vi } from 'vitest'
import { demoPage } from '../src/demo-page.ts'
import { DEMO_SERVER_ADDRESS } from '../src/join-codes.ts'

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

  it('names a placeholder server in commands, and hands every copied line on', async () => {
    const browser = fakePage()
    const copied: string[] = []
    const page = demoPage(browser.page, vi.fn(), vi.fn(), undefined, (text) => void copied.push(text))
    expect(page.origin).toBe(DEMO_SERVER_ADDRESS)
    expect(await page.copyText(' --join hbj_x')).toBe(true)
    expect(copied).toEqual([' --join hbj_x'])
    expect(browser.copied).toEqual([' --join hbj_x'])
    expect(await demoPage(browser.page, vi.fn(), vi.fn()).copyText('plain')).toBe(true)
  })

  it('takes the language and appearance the address chose over the browser’s, and never stores them', () => {
    const browser = fakePage()
    browser.local.set('homingbird.tour', 'seen')
    const page = demoPage(browser.page, vi.fn(), vi.fn(), { language: 'ko', appearance: 'dark' })
    expect(page.languages()).toEqual(['ko'])
    expect(page.storage.local('homingbird.appearance')).toBe('dark')
    page.storage.setLocal('homingbird.appearance', 'light')
    page.storage.setLocal('homingbird.other', 'kept')
    expect(browser.local.get('homingbird.appearance')).toBeUndefined()
    expect(page.storage.local('homingbird.other')).toBe('kept')
    expect(page.storage.local('homingbird.tour')).toBe('seen')
    const unchosen = demoPage(browser.page, vi.fn(), vi.fn(), { language: null, appearance: null })
    expect(unchosen.languages()).toEqual(['en-GB'])
    expect(unchosen.storage).toBe(browser.page.storage)
  })
})

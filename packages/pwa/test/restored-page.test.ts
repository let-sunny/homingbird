import { describe, expect, it } from 'vitest'
import { USUAL_LOAD_SECONDS } from '../src/load-timing.ts'
import { guardRestoredPage } from '../src/restored-page.ts'
import { fail, hold, settle, testApp } from './support/app.ts'
import { usingFakeDom } from './support/dom.ts'
import { BEN, me, member } from './support/fixtures.ts'

usingFakeDom()

const leave = (handlers: Parameters<typeof testApp>[0]) => {
  const test = testApp(handlers)
  test.state.session.set(me())
  const root = document.createElement('div')
  guardRestoredPage(test.app, root)
  test.page.emit('pagehide')
  return { ...test, root }
}

describe('guardRestoredPage', () => {
  it('hides the page as it is left, and shows it again for the same person only once the server says so', async () => {
    const answer = hold<unknown>()
    const { root, page } = leave({ 'me.get': () => answer.waiting })
    expect(root.hidden).toBe(true)
    page.restore()
    await settle()
    expect(root.hidden).toBe(true)
    answer.release(me())
    await settle()
    expect(root.hidden).toBe(false)
    expect(page.visited).toEqual([])
  })

  it('loads the page anew, still hidden, when the server cannot say, or not in time', async () => {
    const away = leave({ 'me.get': () => fail({ _tag: 'Unavailable', message: 'down' }) })
    away.page.restore()
    await settle()
    expect([away.page.visited, away.root.hidden]).toEqual([['reload'], true])
    const slow = leave({ 'me.get': () => hold().waiting })
    slow.page.restore()
    await slow.clock.advance(USUAL_LOAD_SECONDS * 1000)
    expect([slow.page.visited, slow.root.hidden]).toEqual([['reload'], true])
  })

  it('shows sign-in, holding nothing, when the person signed out elsewhere, and starts anew for another', async () => {
    const out = leave({ 'me.get': () => fail({ _tag: 'Unauthorized', message: 'out' }) })
    out.state.announcement.set('New note from Ben')
    out.page.restore()
    await settle()
    expect([out.state.session.get(), out.state.announcement.get(), out.root.hidden]).toEqual([
      null,
      '',
      false,
    ])
    const other = leave({ 'me.get': () => ({ ...me(), member: member(BEN, 'Ben') }) })
    other.page.restore()
    await settle()
    expect([other.page.visited, other.state.session.get()]).toEqual([['reload'], null])
  })

  it('loads a page anew whose session ended before it was left', () => {
    const { app, page, routes } = leave({})
    app.endSession()
    page.restore()
    expect(page.visited).toEqual(['reload'])
    expect(routes()).toEqual([])
  })
})

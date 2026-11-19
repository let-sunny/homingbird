import { describe, expect, it } from 'vitest'
import { VISIBLE_RENEWAL_MS, reportVisibility } from '../../src/tasks/presence.ts'
import { fail, settle, testApp } from '../support/app.ts'

describe('reportVisibility', () => {
  it('reports whether the page is visible when that changes, and renews it while it stays visible', async () => {
    const { run, sent, page, clock } = testApp({
      'presence.visibility': () => fail({ _tag: 'Unavailable', message: 'down' }),
    })
    await run(reportVisibility)
    await settle()
    expect(sent).toEqual([
      { route: 'presence.visibility', request: { body: { page: 'page-id', visible: true } } },
    ])
    page.state.visible = false
    page.emit('visibilitychange')
    await settle()
    expect(sent.at(-1)!.request).toEqual({ body: { page: 'page-id', visible: false } })
    await clock.advance(VISIBLE_RENEWAL_MS)
    expect(sent).toHaveLength(2)
    page.state.visible = true
    await clock.advance(VISIBLE_RENEWAL_MS)
    expect(sent).toHaveLength(3)
  })
})

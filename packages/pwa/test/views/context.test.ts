import { describe, expect, it } from 'vitest'
import { browserDocument } from '../../src/page-document.ts'
import { createViewContext } from '../../src/views/context.ts'
import { settle, testApp } from '../support/app.ts'
import { conversation, note } from '../support/fixtures.ts'

describe('createViewContext', () => {
  it('gives views the app’s state, clock, page and actions that start its tasks', async () => {
    const { app, routes } = testApp()
    const page = browserDocument(() => document)
    const context = createViewContext(app, page)
    expect(context.state).toBe(app.state)
    expect(context.document).toBe(page)
    expect(context.clock).toBe(app.clock)
    context.actions.loadConversations()
    await settle()
    expect(routes()).toEqual(['conversations.list'])
    expect(
      context.justArrived(
        conversation({ lastNote: note('n1', { sentAt: app.clock.now() + 1 }) }),
        'mem_ana000000000' as never,
      ),
    ).toBe(true)
    expect(typeof context.tour.start).toBe('function')
  })
})

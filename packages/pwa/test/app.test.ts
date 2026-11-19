import { Task as T } from '@homingbird/kernel'
import { describe, expect, it, vi } from 'vitest'
import { withApp } from '../src/app.ts'
import { strings } from '../src/strings.ts'
import { settle, testApp } from './support/app.ts'
import { me } from './support/fixtures.ts'

describe('launching a task', () => {
  it('passes what it gives to what comes next', async () => {
    const { app } = testApp()
    const done = vi.fn()
    app.launch(T.succeed(3), { done })
    app.launch(T.succeed(4))
    await settle()
    expect(done).toHaveBeenCalledWith(3)
  })

  it('reports a refusal as a notice in the words of the attempt, after telling the view', async () => {
    const { app } = testApp()
    const failed = vi.fn()
    app.launch(T.fail({ _tag: 'Conflict' as const, message: 'handled' }), { failed, attempt: 'draft' })
    await settle()
    expect(failed).toHaveBeenCalled()
    expect(app.state.notice.get()).toEqual({ kind: 'error', text: strings.refusals.draftHandled })
  })

  it('brings the list up to date after a conflict', async () => {
    const { app, launched } = testApp()
    app.launch(T.fail({ _tag: 'Conflict' as const, message: 'x' }))
    await settle()
    expect(launched).toEqual(['after conflict'])
  })

  it('signs the page out when the session ended, and shows a defect as it is', async () => {
    const { app } = testApp()
    app.state.session.set(me())
    app.launch(T.fail({ _tag: 'Unauthorized' as const, message: 'expired' }))
    await settle()
    expect(app.state.session.get()).toBeNull()
    app.launch(T.die('broken'))
    await settle()
    expect(app.state.notice.get()).toEqual({ kind: 'error', text: 'broken' })
    app.state.notice.set(null)
    app.launch(T.interrupt)
    await settle()
    expect(app.state.notice.get()).toBeNull()
  })

  it('gives a task the app it runs with', async () => {
    const { app, run } = testApp()
    expect(await run(withApp((given) => T.succeed(given === app)))).toEqual({ _tag: 'Ok', value: true })
  })
})

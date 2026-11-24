import { Task as T } from '@homingbird/kernel'
import { describe, expect, it, vi } from 'vitest'
import { withApp } from '../src/app.ts'
import { strings } from '../src/strings.ts'
import { fail, hold, settle, testApp } from './support/app.ts'
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

  it('signs the page out when the session ended', async () => {
    const { app } = testApp()
    app.state.session.set(me())
    app.launch(T.fail({ _tag: 'Unauthorized' as const, message: 'expired' }))
    await settle()
    expect(app.state.session.get()).toBeNull()
  })

  it('shows a defect as it is, and nothing of an interruption', async () => {
    const { app } = testApp()
    app.launch(T.die('broken'))
    await settle()
    expect(app.state.notice.get()).toEqual({ kind: 'error', text: 'broken' })
    app.state.notice.set(null)
    app.launch(T.interrupt)
    await settle()
    expect(app.state.notice.get()).toBeNull()
  })

  it('ends the session at a refused request, even one whose failure the task would have hidden', async () => {
    const { app } = testApp({ 'me.get': () => fail({ _tag: 'Unauthorized', message: 'expired' }) })
    app.state.session.set(me())
    const recovered = vi.fn()
    const failed = vi.fn()
    app.launch(T.catchAll(() => T.sync(recovered))(withApp(({ api }) => T.asUnit(api['me.get']({})))), {
      done: recovered,
      failed,
    })
    await settle()
    expect(app.ended.aborted).toBe(true)
    expect(app.state.session.get()).toBeNull()
    expect(recovered).not.toHaveBeenCalled()
    expect(failed).not.toHaveBeenCalled()
  })

  it('leaves a refusal before anyone signed in to the start of the page', async () => {
    const { app, run } = testApp({ 'me.get': () => fail({ _tag: 'Unauthorized', message: 'nobody' }) })
    expect(await run(withApp(({ api }) => api['me.get']({})))).toMatchObject({ _tag: 'Err' })
    expect(app.ended.aborted).toBe(false)
  })

  it('tells no one of a task the end of the session cut off, and starts none after it', async () => {
    const answer = hold<unknown>()
    const { app, routes, aborted } = testApp({ 'conversations.list': () => answer.waiting })
    app.state.session.set(me())
    const told = vi.fn()
    app.launch(
      withApp(({ api }) => api['conversations.list']({})),
      { done: told, failed: told },
    )
    await settle()
    app.endSession()
    app.endSession()
    answer.release({ conversations: [] })
    app.launch(withApp(({ api }) => T.asUnit(api['me.get']({}))))
    await settle()
    expect(aborted).toEqual(['conversations.list'])
    expect(routes()).toEqual(['conversations.list'])
    expect(told).not.toHaveBeenCalled()
  })

  it('gives a task the app it runs with', async () => {
    const { app, run } = testApp()
    expect(await run(withApp((given) => T.succeed(given === app)))).toEqual({ _tag: 'Ok', value: true })
  })
})

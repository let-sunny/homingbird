import { Task as T } from '@homingbird/kernel'
import { signal } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import { TOO_LONG_LOAD_SECONDS, USUAL_LOAD_SECONDS } from '../../src/load-timing.ts'
import { growingSlow, untilChanged, untilPageEvent } from '../../src/tasks/waiting-for.ts'
import { settle, testApp } from '../support/app.ts'

describe('growingSlow', () => {
  it('says slower than usual, then too long, by the clock, and then runs what follows', async () => {
    const { run, clock } = testApp()
    const said: string[] = []
    const running = run(
      growingSlow(
        (step) => said.push(step),
        T.sync(() => void said.push('then')),
      ),
    )
    await clock.advance(USUAL_LOAD_SECONDS * 1000)
    expect(said).toEqual(['slow'])
    await clock.advance((TOO_LONG_LOAD_SECONDS - USUAL_LOAD_SECONDS) * 1000)
    await running
    expect(said).toEqual(['slow', 'long', 'then'])
  })
})

describe('untilChanged and untilPageEvent', () => {
  it('end when the counter changes or the page hears the event, and let go of what they listened to when interrupted', async () => {
    const { run, page, app } = testApp()
    const counter = signal(0)
    const changed = run(untilChanged(counter))
    await settle()
    counter.set(1)
    expect((await changed)._tag).toBe('Ok')
    const heard = run(untilPageEvent('online'))
    await settle()
    expect(page.listening('online')).toBe(1)
    page.emit('online')
    expect((await heard)._tag).toBe('Ok')
    const stopped = T.runFork(untilPageEvent('online'), app)
    await settle()
    expect(page.listening('online')).toBe(1)
    await stopped.interrupt()
    expect(page.listening('online')).toBe(0)
  })
})

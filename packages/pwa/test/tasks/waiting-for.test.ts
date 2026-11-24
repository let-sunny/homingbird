import { Task as T } from '@homingbird/kernel'
import { signal } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import { untilChanged, untilHolds } from '../../src/tasks/waiting-for.ts'
import { settle, testApp } from '../support/app.ts'

/** A counter that says how many listen to it. */
const listened = () => {
  const counter = signal(0)
  const listening = { count: 0 }
  return {
    ...counter,
    listening,
    subscribe: (listener: (value: number) => void) => {
      listening.count++
      const stop = counter.subscribe(listener)
      return () => {
        listening.count--
        return stop()
      }
    },
  }
}

describe('untilChanged and untilHolds', () => {
  it('end when the counter changes, or holds what is waited for, at once when it already does', async () => {
    const { run } = testApp()
    const counter = listened()
    const changed = run(untilChanged(counter))
    const reached = run(untilHolds(counter, (count) => count === 2))
    await settle()
    counter.set(1)
    expect((await changed)._tag).toBe('Ok')
    expect(counter.listening.count).toBe(1)
    counter.set(2)
    expect((await reached)._tag).toBe('Ok')
    expect((await run(untilHolds(counter, (count) => count === 2)))._tag).toBe('Ok')
    expect(counter.listening.count).toBe(0)
  })

  it('let go of what they listened to when interrupted, and wait no longer than the session', async () => {
    const { run, app } = testApp()
    const counter = listened()
    const waiting = [
      T.runFork(untilChanged(counter), app),
      T.runFork(
        untilHolds(counter, () => false),
        app,
      ),
    ]
    await settle()
    expect(counter.listening.count).toBe(2)
    for (const one of waiting) await one.interrupt()
    expect(counter.listening.count).toBe(0)
    const outlived = run(untilHolds(counter, () => false))
    await settle()
    app.endSession()
    expect((await outlived)._tag).toBe('Err')
    expect(counter.listening.count).toBe(0)
  })
})

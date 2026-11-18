import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { makeWorkTally } from '../src/work-tally.ts'

describe('a work tally', () => {
  it('is settled before any work starts', async () => {
    await expect(T.runPromise(makeWorkTally().settled)).resolves.toBeUndefined()
  })

  it('settles only once every piece of started work has finished', async () => {
    const work = makeWorkTally()
    work.started()
    work.started()
    let settled = false
    const waiting = T.runPromise(work.settled).then(() => {
      settled = true
    })
    work.finished()
    await Promise.resolve()
    expect(settled).toBe(false)
    work.finished()
    await waiting
    expect(settled).toBe(true)
  })

  it('waits again when new work starts after it settled', async () => {
    const work = makeWorkTally()
    work.started()
    work.finished()
    work.started()
    let settled = false
    const waiting = T.runPromise(work.settled).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    work.finished()
    await waiting
  })
})

import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import {
  ATTEMPT_LIMIT_SECONDS,
  QUIET_RETRY_SECONDS,
  TOO_LONG_LOAD_SECONDS,
  USUAL_LOAD_SECONDS,
  growingSlow,
  retryWaits,
} from '../src/load-timing.ts'
import { testApp } from './support/app.ts'

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

describe('load timing', () => {
  it('says slower than usual before too long, and never calls anything too long under ten seconds', () => {
    expect(USUAL_LOAD_SECONDS).toBeGreaterThan(0)
    expect(TOO_LONG_LOAD_SECONDS).toBeGreaterThan(USUAL_LOAD_SECONDS)
    expect(TOO_LONG_LOAD_SECONDS).toBeGreaterThanOrEqual(10)
  })

  it('repeats after 1, 2, 4 and 8 seconds, so that it gives up as it is called too long', () => {
    expect([...retryWaits()]).toEqual([1000, 2000, 4000, 8000])
    expect([...retryWaits()].reduce((sum, wait) => sum + wait)).toBe(TOO_LONG_LOAD_SECONDS * 1000)
  })

  it('ends an attempt only well after it was called too long', () => {
    expect(ATTEMPT_LIMIT_SECONDS).toBeGreaterThanOrEqual(2 * TOO_LONG_LOAD_SECONDS)
  })

  it('waits longer than the repeats of a load before it quietly loads again', () => {
    expect(QUIET_RETRY_SECONDS).toBeGreaterThanOrEqual(TOO_LONG_LOAD_SECONDS)
  })
})

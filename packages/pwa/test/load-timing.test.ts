import { describe, expect, it } from 'vitest'
import { QUIET_RETRY_SECONDS, TOO_LONG_LOAD_SECONDS, USUAL_LOAD_SECONDS } from '../src/load-timing.ts'

describe('load timing', () => {
  it('says slower than usual before too long, and never calls anything too long under ten seconds', () => {
    expect(USUAL_LOAD_SECONDS).toBeGreaterThan(0)
    expect(TOO_LONG_LOAD_SECONDS).toBeGreaterThan(USUAL_LOAD_SECONDS)
    expect(TOO_LONG_LOAD_SECONDS).toBeGreaterThanOrEqual(10)
  })

  it('waits longer than the repeats of a load before it quietly loads again', () => {
    expect(QUIET_RETRY_SECONDS).toBeGreaterThanOrEqual(TOO_LONG_LOAD_SECONDS)
  })
})

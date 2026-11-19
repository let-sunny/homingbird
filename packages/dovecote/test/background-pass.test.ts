import { Task as T, err, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { logBackgroundEnded, survivingPass } from '../src/background-pass.ts'
import type { AppEnv } from '../src/environment.ts'
import { makeTestLog } from '../src/log/operational-log.ts'

const envWith = (level: 'debug' | 'info' = 'debug') => {
  const clock = makeTestClock(0)
  const testLog = makeTestLog(level)
  return { clock, testLog, env: { clock, log: testLog.log } as unknown as AppEnv }
}

describe('a background pass', () => {
  it('logs a defect or a failure by name and lets its loop run the next pass', async () => {
    const { clock, env, testLog } = envWith('info')
    let passes = 0
    const flaky = T.suspend(() => {
      passes += 1
      if (passes === 1) return T.die(new Error('SQLITE_BUSY: database is locked'))
      if (passes === 2) return T.fail('driver gone' as never)
      return T.unit
    })
    const loop = T.runFork(T.forever(10)(survivingPass('debate deadlines', flaky)), env)
    for (let step = 0; step < 3; step++) await clock.advance(10)
    await loop.interrupt()
    expect(passes).toBeGreaterThanOrEqual(3)
    expect(testLog.events().slice(0, 2)).toMatchObject([
      { eventName: 'background.pass_failed', attributes: { pass: 'debate deadlines', defect: 'Error' } },
      { eventName: 'background.pass_failed', attributes: { pass: 'debate deadlines', defect: 'string' } },
    ])
    expect(testLog.lines.join('\n')).not.toContain('SQLITE_BUSY')
  })

  it('keeps the redacted detail of a defect for debug lines only', async () => {
    const { env, testLog } = envWith('debug')
    await T.run(survivingPass('housekeeping', T.die(new Error('locked for ana@example.com'))), env)
    const detail = testLog.events().find((line) => line.eventName === 'defect.detail')
    expect(detail?.attributes.detail).toContain('locked for [email]')
  })

  it('lets an interruption through, so shutting down still stops the loop', async () => {
    const { env } = envWith()
    const stopped = await T.run(survivingPass('housekeeping', T.interrupt), env)
    expect(stopped).toMatchObject({ _tag: 'Err', error: { _tag: 'Interrupt' } })
  })

  it('says when the background work stopped, and why', () => {
    const { testLog } = envWith('info')
    logBackgroundEnded(testLog.log, err(T.interruptCause))
    logBackgroundEnded(testLog.log, err(T.dieCause(new TypeError('boom'))))
    logBackgroundEnded(testLog.log, err(T.failCause('x' as never)))
    expect(testLog.events()).toMatchObject([
      { eventName: 'background.shutdown' },
      { eventName: 'background.stopped', attributes: { defect: 'TypeError' } },
      { eventName: 'background.stopped', attributes: { defect: 'string' } },
    ])
  })
})

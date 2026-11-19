import { Task as T, err, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { backgroundEnded, survivingPass } from '../src/background-pass.ts'
import type { AppEnv } from '../src/environment.ts'

const envWith = (logged: string[]) => {
  const clock = makeTestClock(0)
  return { clock, env: { clock, log: (line: string) => logged.push(line) } as unknown as AppEnv }
}

describe('a background pass', () => {
  it('logs a defect or a failure and lets its loop run the next pass', async () => {
    const logged: string[] = []
    const { clock, env } = envWith(logged)
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
    expect(logged.slice(0, 2)).toEqual([
      'debate deadlines: a pass failed and the next one runs as planned (SQLITE_BUSY: database is locked)',
      'debate deadlines: a pass failed and the next one runs as planned (driver gone)',
    ])
  })

  it('lets an interruption through, so shutting down still stops the loop', async () => {
    const { env } = envWith([])
    const stopped = await T.run(survivingPass('housekeeping', T.interrupt), env)
    expect(stopped).toMatchObject({ _tag: 'Err', error: { _tag: 'Interrupt' } })
  })

  it('says when the background work stopped, and why', () => {
    expect(backgroundEnded(err(T.interruptCause))).toBe('Background work stopped for shutdown.')
    expect(backgroundEnded(err(T.dieCause(new Error('boom'))))).toMatch(
      /^Background work stopped unexpectedly: .*\(boom\)\. Restart Dovecote\.$/,
    )
    expect(backgroundEnded(err(T.failCause('x' as never)))).toMatch(/no cause given/)
  })
})

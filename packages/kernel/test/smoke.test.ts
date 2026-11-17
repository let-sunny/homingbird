import { describe, expect, it } from 'vitest'
import { Iter, Result, Schema as S, Task as T, makeTestClock, ok, pipe } from '../src/index.ts'

describe('kernel smoke', () => {
  it('sequences tasks with generators and virtual time', async () => {
    const clock = makeTestClock(1000)
    const program = T.gen(function* () {
      const before = yield* T.now
      yield* T.sleep(500)
      const [a, b] = yield* T.all([T.succeed(1), T.succeed('two')])
      return { waited: (yield* T.now) - before, a, b }
    })
    const running = T.run(program, { clock })
    await clock.advance(500)
    expect(await running).toEqual(ok({ waited: 500, a: 1, b: 'two' }))
  })

  it('times out and interrupts the loser', async () => {
    const clock = makeTestClock()
    let cleaned = false
    const slow = T.gen(function* () {
      try {
        yield* T.sleep(10_000)
      } finally {
        cleaned = true
      }
    })
    const running = T.run(pipe(slow, T.timeout(100), T.result), { clock })
    await clock.advance(100)
    expect(Result.unwrap(await running)).toMatchObject({ _tag: 'Err', error: { _tag: 'TimeoutError' } })
    expect(cleaned).toBe(true)
    expect(clock.pending()).toBe(0)
  })

  it('decodes with schemas and iterates lazily', () => {
    const User = S.struct({ name: S.string({ minLength: 1 }), age: S.optional(S.int({ min: 0 })) })
    expect(User.decode({ name: 'a', extra: 1 })).toEqual(ok({ name: 'a' }))
    expect(User.decode({ age: -1 })._tag).toBe('Err')
    expect(pipe(Iter.range(), Iter.filter((n) => n % 2 === 0), Iter.take(3), Iter.toArray)).toEqual([0, 2, 4])
  })
})

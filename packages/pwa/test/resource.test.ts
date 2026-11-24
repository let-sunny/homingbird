import { Task as T, err, makeTestClock, ok } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { QUIET_RETRY_SECONDS, TOO_LONG_LOAD_SECONDS, USUAL_LOAD_SECONDS } from '../src/load-timing.ts'
import { type Source, resource } from '../src/resource.ts'
import { settle } from './support/app.ts'

type Ids = ReadonlyArray<string>

const AWAY: ApiError = { _tag: 'Unavailable', message: 'away' }
const BUSY: ApiError = { _tag: 'RateLimited', message: 'busy' }

const without =
  (id: string) =>
  (ids: Ids): Ids =>
    ids.filter((one) => one !== id)

/** A request on its way: what the server holds is read into it at some moment before it is answered. */
interface Request {
  readonly number: number
  read: Ids | null
  isOver: boolean
  readonly answer: (exit: T.Exit<Ids, ApiError>) => void
}

/** A resource against a server the test answers for, one request after the other. */
const setUp = (initial: Ids = ['kept']) => {
  const clock = makeTestClock(1_000_000)
  const ending = new AbortController()
  const ids = resource<Ids>([])
  const requests: Request[] = []
  const failures: ApiError[] = []
  const defects: unknown[] = []
  const answered: number[] = []
  const server = { ids: initial, hearsChanges: true }
  const ask: T.Task<Ids, ApiError> = T.async((resume) => {
    const request: Request = {
      number: requests.length,
      read: null,
      isOver: false,
      answer: (exit) => {
        request.isOver = true
        resume(exit)
      },
    }
    requests.push(request)
    return () => {
      request.isOver = true
    }
  })
  const source = (): Source<Ids> => ({
    ask,
    clock,
    ended: ending.signal,
    hearsChanges: server.hearsChanges,
    answered: (askedAt) => void answered.push(askedAt),
    failed: (error) => void failures.push(error),
    broke: (defect) => void defects.push(defect),
  })
  const running = (): Request[] => requests.filter((request) => !request.isOver)
  const reply = (request: Request, value = request.read ?? server.ids): void => request.answer(ok(value))
  const refuse = (request: Request, error: ApiError): void => request.answer(err(T.failCause(error)))
  const run = <A>(task: T.Task<A>) => T.run(task)
  const go = (task: T.Task<unknown>): void => void T.run(task)
  const end = (): void => {
    ending.abort()
    ids.reset()
  }
  const askAndAnswer = async (value: Ids): Promise<void> => {
    go(ids.refresh(source()))
    await settle()
    reply(running()[0]!, value)
    await settle()
  }
  return {
    clock,
    ids,
    requests,
    failures,
    defects,
    answered,
    server,
    source,
    running,
    reply,
    refuse,
    run,
    go,
    end,
    askAndAnswer,
  }
}

type Step =
  | { readonly does: 'commit'; readonly id: string }
  | { readonly does: 'decide'; readonly id: string }
  | { readonly does: 'leave'; readonly id: string }
  | {
      readonly does:
        | 'deliver'
        | 'invalidate'
        | 'refresh'
        | 'open'
        | 'again'
        | 'read'
        | 'answer'
        | 'fail'
        | 'outage'
        | 'end'
    }
  | { readonly does: 'wait'; readonly ms: number }

/** After each step, how many microtasks run before the next: none, or any point of an answer being taken in. */
type Scripted = readonly [Step, number]

const anId = fc.constantFrom('a', 'b', 'c')

const steps = (withEnd: boolean): fc.Arbitrary<ReadonlyArray<Scripted>> =>
  fc.array(
    fc.tuple(
      fc.oneof(
        fc.record({
          does: fc.constantFrom('commit' as const, 'decide' as const, 'leave' as const),
          id: anId,
        }),
        fc.record({
          does: fc.constantFrom(
            'deliver' as const,
            'invalidate' as const,
            'refresh' as const,
            'open' as const,
            'again' as const,
            'read' as const,
            'answer' as const,
            'answer' as const,
            'fail' as const,
            'outage' as const,
            ...(withEnd ? (['end'] as const) : []),
          ),
        }),
        fc.record({ does: fc.constant('wait' as const), ms: fc.constantFrom(500, 2500, 31_000) }),
      ),
      fc.oneof(fc.integer({ min: 0, max: 12 }), fc.constant(40)),
    ),
    { maxLength: 40, size: 'max' },
  )

const microtasks = async (count: number): Promise<void> => {
  for (let one = 0; one < count; one++) await Promise.resolve()
}

interface Refreshed {
  readonly startedAfter: number
  outcome: boolean | 'interrupted' | null
  newestAnswer: number
}

/** Plays a script, checking what must hold at every moment, and tells what it counted. */
const play = async (script: ReadonlyArray<Scripted>) => {
  const test = setUp()
  const { ids, server, source, running, requests, clock } = test
  const events: Array<() => void> = []
  const refreshes: Refreshed[] = []
  const counted = { wanted: 0, failed: 0 }
  let newestAnswer = -1
  let hasEnded = false
  let wasLoaded = false
  const broken: string[] = []
  const gone = new Set<string>()
  const removeHere = (id: string): void => {
    if (!server.ids.includes(id)) gone.add(id)
    ids.update(without(id))
  }
  const check = (): void => {
    if (running().length > 1) broken.push('I1: more than one request at a time')
    if (ids.load.get().loaded) wasLoaded = true
    if (ids.get().some((id) => gone.has(id))) broken.push('I4: what was removed is shown again')
    if (hasEnded && ids.get().length > 0) broken.push('I6: not empty after the end')
    if (!hasEnded && wasLoaded && !ids.get().includes('kept')) broken.push('I7: emptied by a failure')
  }
  ids.subscribe(check)
  ids.load.subscribe(check)
  const refresh = (): void => {
    counted.wanted++
    const refreshed: Refreshed = { startedAfter: requests.length, outcome: null, newestAnswer: -1 }
    refreshes.push(refreshed)
    void T.run(ids.refresh(source())).then((exit) => {
      refreshed.outcome = exit._tag === 'Ok' ? exit.value : 'interrupted'
      refreshed.newestAnswer = newestAnswer
    })
  }
  const take = async (step: Step): Promise<void> => {
    const request = running()[0]
    switch (step.does) {
      case 'commit':
        server.ids = [...without(step.id)(server.ids), step.id]
        gone.delete(step.id)
        events.push(() => {
          counted.wanted++
          test.go(ids.invalidate(source()))
        })
        break
      case 'decide':
        server.ids = without(step.id)(server.ids)
        removeHere(step.id)
        break
      case 'leave':
        server.ids = without(step.id)(server.ids)
        events.push(() => removeHere(step.id))
        break
      case 'deliver':
        events.shift()?.()
        break
      case 'refresh':
        refresh()
        break
      case 'invalidate':
      case 'open':
      case 'again':
        counted.wanted++
        test.go(ids[step.does](source()))
        break
      case 'read':
        if (request !== undefined) request.read ??= server.ids
        break
      case 'answer':
        if (request === undefined) break
        newestAnswer = request.number
        test.reply(request)
        break
      case 'fail':
        if (request === undefined) break
        counted.failed++
        test.refuse(request, request.number % 2 === 0 ? AWAY : BUSY)
        break
      case 'outage':
        for (let failed = running()[0]; failed !== undefined; failed = running()[0]) {
          counted.failed++
          test.refuse(failed, AWAY)
          await settle()
          check()
          if (ids.load.get().step === 'failed') break
          await clock.advance(8000)
        }
        break
      case 'wait':
        await clock.advance(step.ms)
        break
      case 'end':
        hasEnded = true
        test.end()
        break
    }
  }
  for (const [step, pause] of script) {
    if (hasEnded && (step.does === 'decide' || step.does === 'deliver')) continue
    await take(step)
    await microtasks(pause)
    check()
  }
  if (!hasEnded) while (events.length > 0) events.shift()?.()
  await settle()
  for (let round = 0; round < 60 && (running().length > 0 || clock.pending() > 0); round++) {
    const request = running()[0]
    if (request !== undefined) {
      newestAnswer = request.number
      test.reply(request)
    } else await clock.advance(QUIET_RETRY_SECONDS * 1000)
    await settle()
    check()
  }
  await settle()
  expect(broken).toEqual([])
  expect(test.defects).toEqual([])
  return { ...test, refreshes, counted, hasEnded }
}

describe('a resource, whatever the order of events, actions and answers', () => {
  it('has one request at a time, ends every refresh with a newer answer, and ends as the server is', async () => {
    await fc.assert(
      fc.asyncProperty(steps(false), async (script) => {
        const { ids, server, refreshes, requests, counted, answered } = await play(script)
        for (const refreshed of refreshes) {
          expect(refreshed.outcome, 'I5: every refresh ends').not.toBeNull()
          if (refreshed.outcome === true)
            expect(refreshed.newestAnswer, 'I2: with an answer asked for after it').toBeGreaterThanOrEqual(
              refreshed.startedAfter,
            )
        }
        const { loaded, step } = ids.load.get()
        if (loaded && step !== 'failed')
          expect([...ids.get()].sort(), 'I3: ends as the server is').toEqual([...server.ids].sort())
        if (answered.length > 0) expect(loaded, 'I7').toBe(true)
        expect(requests.length, 'I9: no request nobody asked for').toBeLessThanOrEqual(
          counted.wanted + counted.failed,
        )
      }),
      { numRuns: 1000 },
    )
  })

  it('holds nothing and runs nothing once the session ended, and leaves nobody waiting', async () => {
    await fc.assert(
      fc.asyncProperty(steps(true), steps(true), async (before, after) => {
        const ended = [...before, [{ does: 'end' }, 0] as const, ...after]
        const { ids, refreshes, running, clock } = await play(ended)
        expect(ids.get()).toEqual([])
        expect(ids.load.get()).toEqual({ loaded: false, step: 'idle', error: null })
        expect(running()).toEqual([])
        expect(clock.pending()).toBe(0)
        for (const refreshed of refreshes) expect(refreshed.outcome).not.toBeNull()
      }),
      { numRuns: 500 },
    )
  })

  it('asks once more for any number of changes during one request', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (changes) => {
        const { ids, source, go, requests, running, reply } = setUp()
        go(ids.open(source()))
        await settle()
        for (let one = 0; one < changes; one++) go(ids.invalidate(source()))
        await settle()
        expect(requests).toHaveLength(1)
        reply(running()[0]!)
        await settle()
        reply(running()[0]!)
        await settle()
        expect(requests).toHaveLength(2)
      }),
      { numRuns: 50 },
    )
  })
})

describe('a change while a request runs', () => {
  it('is made again on the answer, so what was decided never comes back', async () => {
    const { ids, source, go, running, reply, askAndAnswer } = setUp()
    await askAndAnswer(['a', 'b'])
    go(ids.invalidate(source()))
    await settle()
    const seen: Ids[] = []
    ids.subscribe((now) => seen.push(now))
    ids.update(without('a'))
    reply(running()[0]!, ['a', 'b', 'c'])
    await settle()
    expect(seen).toEqual([['b'], ['b', 'c']])
  })

  it('is not made again on an answer asked for after it', async () => {
    const { ids, source, go, running, reply, refuse, clock } = setUp()
    go(ids.open(source()))
    await settle()
    ids.update(without('a'))
    refuse(running()[0]!, AWAY)
    await settle()
    await clock.advance(1000)
    reply(running()[0]!, ['a'])
    await settle()
    expect(ids.get()).toEqual(['a'])
    go(ids.refresh(source()))
    await settle()
    reply(running()[0]!, ['a', 'b'])
    await settle()
    expect(ids.get()).toEqual(['a', 'b'])
  })

  it('replaces the whole value when it is set, on the answer too', async () => {
    const { ids, source, go, running, reply } = setUp()
    go(ids.open(source()))
    await settle()
    ids.set(['mine'])
    reply(running()[0]!, ['older'])
    await settle()
    expect(ids.get()).toEqual(['mine'])
  })
})

describe('refresh', () => {
  it('never ends with the answer of a request that already ran', async () => {
    const { ids, source, run, go, running, reply } = setUp()
    go(ids.open(source()))
    await settle()
    let ended = false
    const refreshed = run(ids.refresh(source())).then((exit) => {
      ended = true
      return exit
    })
    reply(running()[0]!, ['older'])
    await settle()
    expect(ended).toBe(false)
    reply(running()[0]!, ['newer'])
    expect(await refreshed).toMatchObject({ value: true })
    expect(ids.get()).toEqual(['newer'])
  })

  it('ends untrue when its request failed, without waiting for the repeats', async () => {
    const { ids, source, run, running, refuse } = setUp()
    const refreshed = run(ids.refresh(source()))
    await settle()
    refuse(running()[0]!, AWAY)
    expect(await refreshed).toMatchObject({ value: false })
  })
})

describe('open', () => {
  it('joins the running request, shares the one just asked for, and asks again after two seconds', async () => {
    const { ids, source, run, requests, running, reply, clock } = setUp()
    const both = [run(ids.open(source())), run(ids.open(source()))]
    await settle()
    const third = run(ids.open(source()))
    reply(running()[0]!)
    for (const opened of [...both, third]) expect(await opened).toMatchObject({ value: true })
    await clock.advance(1999)
    expect(await run(ids.open(source()))).toMatchObject({ value: true })
    expect(requests).toHaveLength(1)
    await clock.advance(1)
    void run(ids.open(source()))
    await settle()
    expect(requests).toHaveLength(2)
  })

  it('counts those two seconds from when it asked, not from when the answer came', async () => {
    const { ids, source, go, requests, running, reply, clock } = setUp()
    go(ids.open(source()))
    await settle()
    await clock.advance(3000)
    reply(running()[0]!)
    await settle()
    go(ids.open(source()))
    await settle()
    expect(requests).toHaveLength(2)
  })

  it('always asks where the page would not hear of changes', async () => {
    const { ids, source, go, server, requests, askAndAnswer } = setUp()
    await askAndAnswer(['a'])
    server.hearsChanges = false
    go(ids.open(source()))
    await settle()
    expect(requests).toHaveLength(2)
  })

  it('does not wait for the repeats of a request that failed', async () => {
    const { ids, source, run, go, running, refuse, requests } = setUp()
    go(ids.open(source()))
    await settle()
    refuse(running()[0]!, AWAY)
    await settle()
    expect(await run(ids.open(source()))).toMatchObject({ value: false })
    expect(requests).toHaveLength(1)
  })
})

describe('again', () => {
  it('ends the running request, whose late answer changes nothing, and asks afresh', async () => {
    const { ids, source, run, go, requests, running, reply } = setUp()
    const opened = run(ids.open(source()))
    await settle()
    const first = running()[0]!
    go(ids.again(source()))
    await settle()
    expect(first.isOver).toBe(true)
    expect(requests).toHaveLength(2)
    expect(await opened).toMatchObject({ value: false })
    reply(first, ['late'])
    await settle()
    expect(ids.get()).toEqual([])
    reply(running()[0]!, ['fresh'])
    await settle()
    expect(ids.get()).toEqual(['fresh'])
  })
})

describe('again, however far the run it ends had come', () => {
  it('leaves nobody waiting', async () => {
    for (let pause = 0; pause < 20; pause++) {
      const { ids, source, go, run, running, reply } = setUp()
      let hasEnded = false
      void run(ids.refresh(source())).then(() => {
        hasEnded = true
      })
      await microtasks(pause)
      go(ids.again(source()))
      await settle()
      reply(running()[0]!)
      await settle()
      expect(hasEnded, `after ${pause} microtasks`).toBe(true)
    }
  })
})

describe('a failed request', () => {
  it('keeps the value, is repeated after 1, 2, 4 and 8 seconds, and then quietly every 30', async () => {
    const { ids, source, go, requests, running, refuse, reply, clock, askAndAnswer } = setUp()
    await askAndAnswer(['a'])
    go(ids.invalidate(source()))
    await settle()
    for (const seconds of [1, 2, 4, 8]) {
      refuse(running()[0]!, AWAY)
      await settle()
      expect(ids.load.get()).toMatchObject({ loaded: true, step: 'loading' })
      await clock.advance(seconds * 1000 - 1)
      expect(running()).toEqual([])
      await clock.advance(1)
      expect(running()).toHaveLength(1)
    }
    refuse(running()[0]!, BUSY)
    await settle()
    expect(ids.load.get()).toEqual({ loaded: true, step: 'failed', error: BUSY })
    expect(ids.get()).toEqual(['a'])
    for (const answer of [refuse, null]) {
      await clock.advance(QUIET_RETRY_SECONDS * 1000)
      expect(ids.load.get().step).toBe('failed')
      if (answer === null) reply(running()[0]!, ['b'])
      else answer(running()[0]!, AWAY)
      await settle()
    }
    expect(requests).toHaveLength(8)
    expect(ids.get()).toEqual(['b'])
    expect(ids.load.get()).toEqual({ loaded: true, step: 'idle', error: null })
    expect(clock.pending()).toBe(0)
  })

  it('serves what was asked meanwhile with its next attempt rather than with one more request', async () => {
    const { ids, source, run, go, requests, running, refuse, reply, clock } = setUp()
    go(ids.open(source()))
    await settle()
    const refreshed = run(ids.refresh(source()))
    refuse(running()[0]!, AWAY)
    await settle()
    go(ids.invalidate(source()))
    await clock.advance(1000)
    reply(running()[0]!, ['a'])
    expect(await refreshed).toMatchObject({ value: true })
    await settle()
    expect(requests).toHaveLength(2)
  })

  it.each(['Forbidden', 'NotFound', 'Invalid', 'Conflict', 'Unauthorized'] as const)(
    'empties the value when the server refuses with %s, and is not repeated',
    async (_tag) => {
      const { ids, source, go, requests, running, refuse, failures, clock, askAndAnswer } = setUp()
      await askAndAnswer(['secret'])
      go(ids.invalidate(source()))
      await settle()
      const refusal: ApiError = { _tag, message: 'no' }
      refuse(running()[0]!, refusal)
      await settle()
      expect(ids.get()).toEqual([])
      expect(ids.load.get()).toEqual({ loaded: false, step: 'failed', error: refusal })
      expect(failures).toEqual([refusal])
      await clock.advance(QUIET_RETRY_SECONDS * 2000)
      expect(requests).toHaveLength(2)
    },
  )

  it('asks once more after a refusal for what changed meanwhile', async () => {
    const { ids, source, go, running, refuse, reply } = setUp()
    go(ids.open(source()))
    await settle()
    go(ids.invalidate(source()))
    refuse(running()[0]!, { _tag: 'Forbidden', message: 'no' })
    await settle()
    reply(running()[0]!, ['a'])
    await settle()
    expect(ids.get()).toEqual(['a'])
  })

  it('tells a defect, empties, and leaves nobody waiting', async () => {
    const { ids, source, run, defects, requests } = setUp()
    const broken = { ...source(), ask: T.die('broken') }
    expect(await run(ids.refresh(broken))).toMatchObject({ value: false })
    await settle()
    expect(defects).toEqual(['broken'])
    expect(ids.load.get()).toEqual({ loaded: false, step: 'failed', error: null })
    const stopped = { ...source(), ask: T.interrupt }
    expect(await run(ids.refresh(stopped))).toMatchObject({ value: false })
    expect(defects).toHaveLength(1)
    expect(requests).toHaveLength(0)
  })

  it('tells a defect of one who listens, which the answer does not undo', async () => {
    const { ids, source, run, running, reply, defects } = setUp()
    ids.subscribe(() => {
      throw new Error('listener')
    })
    const refreshed = run(ids.refresh(source()))
    await settle()
    reply(running()[0]!, ['a'])
    expect((await refreshed)._tag).toBe('Ok')
    await settle()
    expect(defects).toHaveLength(1)
    expect(ids.get()).toEqual(['a'])
  })
})

describe('how long a request takes', () => {
  it('is told while the first answer is awaited, and not once a value is shown', async () => {
    const { ids, source, go, running, reply, clock } = setUp()
    go(ids.open(source()))
    await settle()
    const seen = [ids.load.get().step]
    ids.load.subscribe((load) => seen.push(load.step))
    await clock.advance(USUAL_LOAD_SECONDS * 1000)
    await clock.advance((TOO_LONG_LOAD_SECONDS - USUAL_LOAD_SECONDS) * 1000)
    reply(running()[0]!)
    await settle()
    go(ids.invalidate(source()))
    await clock.advance(TOO_LONG_LOAD_SECONDS * 1000)
    reply(running()[0]!)
    await settle()
    expect(seen).toEqual(['loading', 'slow', 'long', 'idle', 'loading', 'idle'])
    expect(clock.pending()).toBe(0)
  })
})

describe('the end of the session', () => {
  it('interrupts a running request, and nothing is asked after it', async () => {
    const { ids, source, run, go, requests, running, end } = setUp()
    const opened = run(ids.open(source()))
    const refreshed = run(ids.refresh(source()))
    await settle()
    const request = running()[0]!
    end()
    expect(request.isOver).toBe(true)
    expect(await opened).toMatchObject({ value: false })
    expect(await refreshed).toMatchObject({ value: false })
    go(ids.invalidate(source()))
    expect(await run(ids.refresh(source()))).toMatchObject({ value: false })
    await settle()
    expect(requests).toHaveLength(1)
    expect(ids.load.get().step).toBe('idle')
  })

  it('keeps an answer being taken in from being written, however far it had come', async () => {
    for (let pause = 0; pause < 30; pause++) {
      const { ids, source, go, running, reply, end } = setUp()
      go(ids.open(source()))
      await settle()
      reply(running()[0]!, ['late'])
      await microtasks(pause)
      end()
      await settle()
      expect(ids.get()).toEqual([])
    }
  })
})

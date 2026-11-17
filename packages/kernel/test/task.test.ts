import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  type Clock,
  type HasClock,
  Iter,
  Schedule,
  Task as T,
  err,
  makeTestClock,
  ok,
  pipe,
  tagged,
} from '../src/index.ts'
import { died, failed, flush, interrupted, isSettled, probe, setup, trackListeners } from './helpers.ts'

const NotFound = tagged('NotFound')<{ readonly id: number }>()
type NotFound = ReturnType<typeof NotFound>
const Denied = tagged('Denied')()
type Denied = ReturnType<typeof Denied>

const aborted = (): AbortSignal => {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

const arbTask = fc.oneof(
  fc.integer().map((n) => T.succeed(n) as T.Task<number, string>),
  fc.string().map((e) => T.fail(e) as T.Task<number, string>),
)
const f = (n: number): T.Task<number, string> => (n % 2 === 0 ? T.succeed(n + 1) : T.fail(`odd ${n}`))
const g = (n: number): T.Task<number, string> => (n % 3 === 0 ? T.succeed(n * 2) : T.fail(`not3 ${n}`))

describe('constructors', () => {
  it('succeed, fail, die, interrupt and unit settle as their names say', async () => {
    expect(await T.run(T.succeed(1))).toEqual(ok(1))
    expect(await T.run(T.fail('e'))).toEqual(failed('e'))
    expect(await T.run(T.die('boom'))).toEqual(died('boom'))
    expect(await T.run(T.interrupt)).toEqual(interrupted)
    expect(await T.run(T.unit)).toEqual(ok(undefined))
  })

  it('fromExit and fromResult adopt the given outcome', async () => {
    expect(await T.run(T.fromExit(failed('e')))).toEqual(failed('e'))
    expect(await T.run(T.fromResult(ok(1)))).toEqual(ok(1))
    expect(await T.run(T.fromResult(err('e')))).toEqual(failed('e'))
  })

  it('sync turns a throw into a defect and attempt into a typed failure', async () => {
    const boom = new Error('boom')
    expect(await T.run(T.sync(() => 2))).toEqual(ok(2))
    expect(
      await T.run(
        T.sync(() => {
          throw boom
        }),
      ),
    ).toEqual(died(boom))
    expect(await T.run(T.attempt(() => 3, String))).toEqual(ok(3))
    expect(
      await T.run(
        T.attempt(
          () => {
            throw boom
          },
          (cause) => (cause as Error).message,
        ),
      ),
    ).toEqual(failed('boom'))
  })

  it('is lazy: building a task runs nothing', async () => {
    let ran = 0
    const task = T.suspend(() => {
      ran++
      return T.succeed(ran)
    })
    expect(ran).toBe(0)
    expect(await T.run(task)).toEqual(ok(1))
    expect(await T.run(task)).toEqual(ok(2))
  })

  it('every task observes an already-aborted signal before starting', async () => {
    let ran = false
    const task = T.sync(() => {
      ran = true
    })
    expect(await T.run(task, undefined, aborted())).toEqual(interrupted)
    expect(ran).toBe(false)
  })

  it('make turns a rejected run into a defect, never a rejection', async () => {
    const boom = new Error('rejected')
    expect(await T.run(T.make(() => Promise.reject(boom)))).toEqual(died(boom))
  })

  it('isTask recognises only kernel tasks', () => {
    expect(T.isTask(T.succeed(1))).toBe(true)
    expect(T.isTask(T.Clock)).toBe(true)
    expect(T.isTask({ run: () => {} })).toBe(false)
    expect(T.isTask(null)).toBe(false)
    expect(T.isTask('task')).toBe(false)
  })

  it('pipe threads the task through each function', async () => {
    const task = T.succeed(1).pipe(
      T.map((n) => n + 1),
      T.map((n) => n * 10),
    )
    expect(await T.run(task)).toEqual(ok(20))
    expect(T.succeed(1).pipe((self) => T.isTask(self))).toBe(true)
  })
})

describe('promise interop', () => {
  it('promise resolves with the value and passes the signal through', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const task = T.promise(async (signal) => {
      seen = signal
      return 7
    })
    expect(await T.run(task, undefined, controller.signal)).toEqual(ok(7))
    expect(seen).toBe(controller.signal)
  })

  it('promise treats a rejection and a synchronous throw as defects', async () => {
    const boom = new Error('no')
    expect(await T.run(T.promise(() => Promise.reject(boom)))).toEqual(died(boom))
    expect(
      await T.run(
        T.promise(() => {
          throw boom
        }),
      ),
    ).toEqual(died(boom))
  })

  it('tryPromise maps a rejection to a typed failure', async () => {
    expect(await T.run(T.tryPromise(() => Promise.resolve(1), String))).toEqual(ok(1))
    expect(
      await T.run(
        T.tryPromise(
          () => Promise.reject(new Error('down')),
          (cause) => (cause as Error).message,
        ),
      ),
    ).toEqual(failed('down'))
  })

  it('interrupts promptly even when the promise ignores the signal, and removes its listener', async () => {
    const controller = new AbortController()
    const listeners = trackListeners(controller.signal)
    const running = T.run(
      T.promise(() => new Promise<number>(() => {})),
      undefined,
      controller.signal,
    )
    expect(await isSettled(running)).toBe(false)
    controller.abort()
    expect(await running).toEqual(interrupted)

    const finishes = new AbortController()
    const count = trackListeners(finishes.signal)
    await T.run(
      T.promise(async () => 1),
      undefined,
      finishes.signal,
    )
    expect(count()).toBe(0)
    expect(listeners()).toBeLessThanOrEqual(1)
  })

  it('reports interruption when the signal aborts just as the promise settles', async () => {
    for (const settle of ['resolve', 'reject'] as const) {
      const controller = new AbortController()
      const task = T.promise(
        () =>
          new Promise<number>((resolve, reject) => {
            queueMicrotask(() => {
              controller.abort()
              settle === 'resolve' ? resolve(1) : reject(new Error('late'))
            })
          }),
      )
      expect(await T.run(task, undefined, controller.signal)).toEqual(interrupted)
    }
  })

  it('swallows the late rejection of a promise it abandoned', async () => {
    const controller = new AbortController()
    let reject!: (reason: unknown) => void
    const running = T.run(
      T.promise(() => new Promise<number>((_, r) => (reject = r))),
      undefined,
      controller.signal,
    )
    await flush()
    controller.abort()
    expect(await running).toEqual(interrupted)
    reject(new Error('too late'))
    await flush()
  })
})

describe('async', () => {
  it('resumes once, ignoring later resumes', async () => {
    const task = T.async<number, string>((resume) => {
      resume(ok(1))
      resume(failed('ignored'))
      return () => {}
    })
    expect(await T.run(task)).toEqual(ok(1))
  })

  it('calls the canceller exactly once on interruption and ignores a resume after it', async () => {
    const controller = new AbortController()
    let cancelled = 0
    let resume!: (exit: T.Exit<number, never>) => void
    const running = T.run(
      T.async<number>((r) => {
        resume = r
        return () => cancelled++
      }),
      undefined,
      controller.signal,
    )
    await flush()
    controller.abort()
    controller.abort()
    expect(await running).toEqual(interrupted)
    resume(ok(1))
    expect(cancelled).toBe(1)
  })

  it('detaches its abort listener after resuming', async () => {
    const controller = new AbortController()
    const listeners = trackListeners(controller.signal)
    let resume!: (exit: T.Exit<number, never>) => void
    const running = T.run(
      T.async<number>((r) => {
        resume = r
        return () => {}
      }),
      undefined,
      controller.signal,
    )
    await flush()
    expect(listeners()).toBe(1)
    resume(ok(5))
    expect(await running).toEqual(ok(5))
    expect(listeners()).toBe(0)
  })

  it('never ends only by interruption', async () => {
    const controller = new AbortController()
    const running = T.run(T.never, undefined, controller.signal)
    expect(await isSettled(running)).toBe(false)
    controller.abort()
    expect(await running).toEqual(interrupted)
  })
})

describe('environment', () => {
  it('ask reads the whole environment and service one slot of it', async () => {
    const Greeter = T.service<{ greet: (name: string) => string }>()('greeter')
    const env = Greeter.of({ greet: (name) => `hi ${name}` })
    expect(Greeter.key).toBe('greeter')
    expect(await T.run(T.ask<typeof env>(), env)).toEqual(ok(env))
    expect(await T.run(T.map((g: { greet: (n: string) => string }) => g.greet('pip'))(Greeter), env)).toEqual(
      ok('hi pip'),
    )
  })

  it('provide supplies part of the environment and overrides what is already there', async () => {
    const task = T.ask<{ a: number; b: number }>()
    const partly = T.provide({ a: 1 })(task)
    expectTypeOf<T.EnvOf<typeof partly>>().toEqualTypeOf<Omit<{ a: number; b: number }, 'a'>>()
    expect(await T.run(partly, { b: 2 })).toEqual(ok({ a: 1, b: 2 }))
    expect(await T.run(T.provide({ a: 9 })(task), { a: 1, b: 2 } as never)).toEqual(ok({ a: 9, b: 2 }))
  })
})

describe('sequencing', () => {
  it('obeys the monad laws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer(), arbTask, async (n, task) => {
        expect(await T.run(T.flatMap(f)(T.succeed(n)))).toEqual(await T.run(f(n)))
        expect(await T.run(T.flatMap(T.succeed<number>)(task))).toEqual(await T.run(task))
        expect(await T.run(pipe(task, T.flatMap(f), T.flatMap(g)))).toEqual(
          await T.run(T.flatMap((x: number) => T.flatMap(g)(f(x)))(task)),
        )
      }),
    )
  })

  it('obeys the functor laws', async () => {
    await fc.assert(
      fc.asyncProperty(arbTask, async (task) => {
        expect(await T.run(T.map((x: number) => x)(task))).toEqual(await T.run(task))
        expect(
          await T.run(
            pipe(
              task,
              T.map((x) => x + 1),
              T.map((x) => x * 2),
            ),
          ),
        ).toEqual(await T.run(T.map((x: number) => (x + 1) * 2)(task)))
      }),
    )
  })

  it('as, asUnit and tap keep or replace the value', async () => {
    const seen: number[] = []
    expect(await T.run(T.as('x')(T.succeed(1)))).toEqual(ok('x'))
    expect(await T.run(T.asUnit(T.succeed(1)))).toEqual(ok(undefined))
    expect(await T.run(T.tap((n: number) => T.sync(() => seen.push(n)))(T.succeed(4)))).toEqual(ok(4))
    expect(seen).toEqual([4])
    expect(await T.run(T.tap(() => T.fail('tap failed'))(T.succeed(4)))).toEqual(failed('tap failed'))
    expect(await T.run(T.tap(() => T.succeed(0))(T.fail('first')))).toEqual(failed('first'))
  })

  it('mapError rewrites failures only', async () => {
    const up = T.mapError((e: string) => e.toUpperCase())
    expect(await T.run(up(T.fail('e')))).toEqual(failed('E'))
    expect(await T.run(up(T.succeed(1)))).toEqual(ok(1))
    expect(await T.run(up(T.die('d')))).toEqual(died('d'))
    expect(await T.run(up(T.interrupt))).toEqual(interrupted)
  })

  it('catchAll recovers from failures and lets defects and interrupts through', async () => {
    const recover = T.catchAll((e: string) => T.succeed(`recovered ${e}`))
    expect(await T.run(recover(T.fail('e')))).toEqual(ok('recovered e'))
    expect(await T.run(recover(T.succeed(1)))).toEqual(ok(1))
    expect(await T.run(recover(T.die('d')))).toEqual(died('d'))
    expect(await T.run(recover(T.interrupt))).toEqual(interrupted)
  })

  it('catchTag recovers one tag and removes it from the error type', async () => {
    const task = T.fail(NotFound({ id: 1 })) as T.Task<number, NotFound | Denied>
    const handled = T.catchTag('NotFound', (e: NotFound) => T.succeed(-e.id))(task)
    expectTypeOf<T.ErrorOf<typeof handled>>().toEqualTypeOf<Denied>()
    expectTypeOf<T.ValueOf<typeof handled>>().toEqualTypeOf<number>()
    expect(await T.run(handled)).toEqual(ok(-1))
    const other = T.catchTag('NotFound', () => T.succeed(0))(
      T.fail(Denied()) as T.Task<number, NotFound | Denied>,
    )
    expect(await T.run(other)).toEqual(failed(Denied()))
    expect(
      await T.run(T.catchTag('NotFound', () => T.succeed(0))(T.succeed(5) as T.Task<number, NotFound>)),
    ).toEqual(ok(5))
    expect(
      await T.run(T.catchTag('NotFound', () => T.succeed(0))(T.die('d') as T.Task<number, NotFound>)),
    ).toEqual(died('d'))
  })

  it('tapError observes a failure and keeps it', async () => {
    const seen: string[] = []
    const observe = T.tapError((e: string) => T.sync(() => seen.push(e)))
    expect(await T.run(observe(T.fail('e')))).toEqual(failed('e'))
    expect(await T.run(observe(T.succeed(1)))).toEqual(ok(1))
    expect(seen).toEqual(['e'])
  })

  it('result and fold move the failure into the value', async () => {
    expect(await T.run(T.result(T.succeed(1)))).toEqual(ok(ok(1)))
    expect(await T.run(T.result(T.fail('e')))).toEqual(ok(err('e')))
    expect(await T.run(T.result(T.die('d')))).toEqual(died('d'))
    expect(await T.run(T.result(T.interrupt))).toEqual(interrupted)
    const describe = T.fold(
      (e: string) => `bad ${e}`,
      (n: number) => `good ${n}`,
    )
    expect(await T.run(describe(T.succeed(1)))).toEqual(ok('good 1'))
    expect(await T.run(describe(T.fail('e')))).toEqual(ok('bad e'))
  })

  it('exit reifies every outcome except the interruption of the caller', async () => {
    expect(await T.run(T.exit(T.succeed(1)))).toEqual(ok(ok(1)))
    expect(await T.run(T.exit(T.fail('e')))).toEqual(ok(failed('e')))
    expect(await T.run(T.exit(T.die('d')))).toEqual(ok(died('d')))
    expect(await T.run(T.exit(T.interrupt))).toEqual(ok(interrupted))
    const controller = new AbortController()
    const running = T.run(T.exit(T.never), undefined, controller.signal)
    controller.abort()
    expect(await running).toEqual(interrupted)
  })

  it('orDie turns a failure into a defect', async () => {
    expect(await T.run(T.orDie(T.fail('e')))).toEqual(died('e'))
    expect(await T.run(T.orDie(T.succeed(1)))).toEqual(ok(1))
    expect(await T.run(T.orDie(T.interrupt))).toEqual(interrupted)
  })
})

describe('gen', () => {
  it('sequences tasks and infers the error union and the environment intersection', async () => {
    const Name = T.service<string>()('name')
    const program = T.gen(function* () {
      const name = yield* Name
      const at = yield* T.now
      if (at < 0) return yield* T.fail(NotFound({ id: at }))
      if (name === '') return yield* T.fail(Denied())
      return `${name}@${at}`
    })
    expectTypeOf<T.ValueOf<typeof program>>().toEqualTypeOf<string>()
    expectTypeOf<T.ErrorOf<typeof program>>().toEqualTypeOf<NotFound | Denied>()
    expectTypeOf<T.EnvOf<typeof program>>().toEqualTypeOf<{ readonly name: string } & HasClock>()
    expect(await T.run(program, { name: 'pip', clock: makeTestClock(5) })).toEqual(ok('pip@5'))
    expect(await T.run(program, { name: '', clock: makeTestClock(5) })).toEqual(failed(Denied()))
  })

  it('a generator with no yields needs nothing and cannot fail', async () => {
    const program = T.gen(function* () {
      return 1
    })
    expectTypeOf<T.ErrorOf<typeof program>>().toEqualTypeOf<never>()
    expectTypeOf<T.EnvOf<typeof program>>().toEqualTypeOf<unknown>()
    expect(await T.run(program)).toEqual(ok(1))
  })

  it('agrees with flatMap', async () => {
    await fc.assert(
      fc.asyncProperty(arbTask, async (task) => {
        const viaGen = T.gen(function* () {
          const a = yield* task
          const b = yield* f(a)
          return yield* g(b)
        })
        expect(await T.run(viaGen)).toEqual(await T.run(pipe(task, T.flatMap(f), T.flatMap(g))))
      }),
    )
  })

  it('runs finally blocks, and the cleanup tasks they yield, when a step fails', async () => {
    const order: string[] = []
    const program = T.gen(function* () {
      try {
        try {
          yield* T.fail('inner')
        } finally {
          yield* T.sync(() => order.push('inner cleanup'))
        }
      } finally {
        const value = yield* T.succeed('outer cleanup')
        order.push(value)
      }
    })
    expect(await T.run(program)).toEqual(failed('inner'))
    expect(order).toEqual(['inner cleanup', 'outer cleanup'])
  })

  it('keeps unwinding when a cleanup task itself fails', async () => {
    const order: string[] = []
    const program = T.gen(function* () {
      try {
        try {
          yield* T.fail('original')
        } finally {
          yield* T.fail('cleanup failed')
          order.push('unreachable')
        }
      } finally {
        order.push('outer')
      }
    })
    expect(await T.run(program)).toEqual(failed('original'))
    expect(order).toEqual(['outer'])
  })

  it('on interruption runs cleanup uninterruptibly before reporting it', async () => {
    const { clock, env } = setup()
    const controller = new AbortController()
    const work = probe(1_000, 'done', 50)
    const running = T.run(work.task, env, controller.signal)
    await clock.advance(10)
    controller.abort()
    expect(await isSettled(running)).toBe(false)
    await clock.advance(50)
    expect(await running).toEqual(interrupted)
    expect(work).toMatchObject({ started: 1, finished: 0, cleaned: 1 })
    expect(clock.pending()).toBe(0)
  })

  it('a throw inside the generator is a defect', async () => {
    const boom = new Error('thrown')
    const program = T.gen(function* () {
      yield* T.unit
      throw boom
    })
    expect(await T.run(program)).toEqual(died(boom))
  })
})

describe('resources', () => {
  it('uninterruptible shields a started task', async () => {
    const { clock, env } = setup()
    const controller = new AbortController()
    const work = probe(100, 'done')
    const running = T.run(T.uninterruptible(work.task), env, controller.signal)
    await clock.advance(10)
    controller.abort()
    await clock.advance(90)
    expect(await running).toEqual(ok('done'))
    expect(await T.run(T.uninterruptible(T.succeed(1)), undefined, aborted())).toEqual(interrupted)
  })

  it('ensuring runs its finalizer after every outcome, and a failing finalizer wins', async () => {
    let ran = 0
    const count = T.ensuring(T.sync(() => ran++))
    expect(await T.run(count(T.succeed(1)))).toEqual(ok(1))
    expect(await T.run(count(T.fail('e')))).toEqual(failed('e'))
    expect(await T.run(count(T.die('d')))).toEqual(died('d'))
    expect(await T.run(count(T.interrupt))).toEqual(interrupted)
    expect(ran).toBe(4)
    expect(await T.run(T.ensuring(T.die('finalizer'))(T.succeed(1)))).toEqual(died('finalizer'))
  })

  it('ensuring still runs its finalizer when interrupted mid-flight', async () => {
    const { clock, env } = setup()
    const controller = new AbortController()
    let ran = 0
    const running = T.run(T.ensuring(T.sync(() => ran++))(T.sleep(100)), env, controller.signal)
    await clock.advance(1)
    controller.abort()
    expect(await running).toEqual(interrupted)
    expect(ran).toBe(1)
  })

  it('bracket always releases, with the exit of use', async () => {
    const released: unknown[] = []
    const withResource = <A, E>(use: T.Task<A, E>) =>
      T.bracket(
        T.succeed('handle'),
        () => use,
        (resource, exit) => T.sync(() => released.push([resource, exit._tag])),
      )
    expect(await T.run(withResource(T.succeed(1)))).toEqual(ok(1))
    expect(await T.run(withResource(T.fail('e')))).toEqual(failed('e'))
    expect(await T.run(withResource(T.interrupt))).toEqual(interrupted)
    expect(released).toEqual([
      ['handle', 'Ok'],
      ['handle', 'Err'],
      ['handle', 'Err'],
    ])
  })

  it('bracket skips use and release when acquisition fails or the signal is already aborted', async () => {
    let used = 0
    let released = 0
    const guarded = <E>(acquire: T.Task<string, E>) =>
      T.bracket(
        acquire,
        () => T.sync(() => used++),
        () => T.sync(() => released++),
      )
    expect(await T.run(guarded(T.fail('no handle')))).toEqual(failed('no handle'))
    expect(await T.run(guarded(T.succeed('h')), undefined, aborted())).toEqual(interrupted)
    expect([used, released]).toEqual([0, 0])
  })

  it('bracket acquires and releases uninterruptibly, and a failing release wins', async () => {
    const { clock, env } = setup()
    const controller = new AbortController()
    const order: string[] = []
    const running = T.run(
      T.bracket(
        T.map(() => order.push('acquired'))(T.sleep(10)),
        () => T.sleep(1_000),
        () => T.map(() => order.push('released'))(T.sleep(10)),
      ),
      env,
      controller.signal,
    )
    await clock.advance(5)
    controller.abort()
    await clock.advance(5)
    await clock.advance(10)
    expect(await running).toEqual(interrupted)
    expect(order).toEqual(['acquired', 'released'])
    expect(
      await T.run(
        T.bracket(
          T.unit,
          () => T.succeed(1),
          () => T.die('release'),
        ),
      ),
    ).toEqual(died('release'))
  })
})

describe('all', () => {
  it('collects values in input order and types the tuple', async () => {
    const { clock, env } = setup()
    const task = T.all([T.as('slow')(T.sleep(20)), T.as(2)(T.sleep(10)), T.succeed(true)])
    expectTypeOf<T.ValueOf<typeof task>>().toEqualTypeOf<[string, number, boolean]>()
    expectTypeOf<T.EnvOf<typeof task>>().toEqualTypeOf<HasClock>()
    const running = T.run(task, env)
    await clock.advance(20)
    expect(await running).toEqual(ok(['slow', 2, true]))
    expect(await T.run(T.all([]))).toEqual(ok([]))
  })

  it('never runs more tasks at once than the concurrency limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 12 }),
        async (limit, count) => {
          const { clock, env } = setup()
          let active = 0
          let peak = 0
          const tasks = Array.from({ length: count }, (_, index) =>
            T.gen(function* () {
              peak = Math.max(peak, ++active)
              yield* T.sleep(10)
              active--
              return index
            }),
          )
          const running = T.run(T.all(tasks, { concurrency: limit }), env)
          await clock.advance(10 * (count + 1))
          expect(await running).toEqual(ok(Array.from({ length: count }, (_, index) => index)))
          expect(peak).toBeLessThanOrEqual(limit)
          expect(peak).toBe(Math.min(limit, count))
        },
      ),
      { numRuns: 30 },
    )
  })

  it('treats a concurrency below one as one', async () => {
    const order: number[] = []
    const tasks = [1, 2, 3].map((n) => T.sync(() => order.push(n)))
    expect(await T.run(T.all(tasks, { concurrency: 0 }))).toEqual(ok([1, 2, 3]))
    expect(order).toEqual([1, 2, 3])
  })

  it('interrupts the siblings of a failure and waits for their cleanup', async () => {
    const { clock, env } = setup()
    const slow = probe(1_000, 'slow', 30)
    const queued = probe(1, 'queued')
    const running = T.run(
      T.all([slow.task, T.flatMap(() => T.fail('boom'))(T.sleep(10)), queued.task], { concurrency: 2 }),
      env,
    )
    await clock.advance(10)
    expect(await isSettled(running)).toBe(false)
    await clock.advance(30)
    expect(await running).toEqual(failed('boom'))
    expect(slow).toMatchObject({ started: 1, finished: 0, cleaned: 1 })
    expect(queued.started).toBe(0)
    expect(clock.pending()).toBe(0)
  })

  it('reports a defect over a failure over an interruption', async () => {
    expect(await T.run(T.all([T.fail('failure'), T.die('defect'), T.interrupt]))).toEqual(died('defect'))
    expect(await T.run(T.all([T.interrupt, T.fail('failure')]))).toEqual(failed('failure'))
    expect(await T.run(T.all([T.interrupt, T.succeed(1)]))).toEqual(interrupted)
  })

  it('is interrupted with its children when the caller is, and detaches from the caller', async () => {
    const { clock, env } = setup()
    const controller = new AbortController()
    const listeners = trackListeners(controller.signal)
    const a = probe(100)
    const b = probe(100)
    const running = T.run(T.all([a.task, b.task]), env, controller.signal)
    await clock.advance(10)
    controller.abort()
    expect(await running).toEqual(interrupted)
    expect([a.cleaned, b.cleaned]).toEqual([1, 1])
    const finished = new AbortController()
    const count = trackListeners(finished.signal)
    await T.run(T.all([T.succeed(1)]), undefined, finished.signal)
    expect(count()).toBe(0)
    expect(listeners()).toBeGreaterThanOrEqual(0)
  })

  it('struct keeps the keys and forEach maps then collects', async () => {
    const task = T.struct({ n: T.succeed(1), s: T.succeed('a') })
    expectTypeOf<T.ValueOf<typeof task>>().toEqualTypeOf<{ n: number; s: string }>()
    expect(await T.run(task)).toEqual(ok({ n: 1, s: 'a' }))
    expect(await T.run(T.struct({ n: T.succeed(1), bad: T.fail('e') }))).toEqual(failed('e'))
    expect(await T.run(T.forEach([1, 2, 3], (n, index) => T.succeed(n * index)))).toEqual(ok([0, 2, 6]))
    expect(await T.run(T.forEach(new Set([1, 2]), (n) => T.succeed(n), { concurrency: 2 }))).toEqual(
      ok([1, 2]),
    )
  })
})

describe('race', () => {
  it('adopts the first to settle and interrupts and awaits the losers', async () => {
    const { clock, env } = setup()
    const slow = probe(100, 'slow', 20)
    const running = T.run(T.race([slow.task, T.as('fast')(T.sleep(10))]), env)
    await clock.advance(10)
    expect(await isSettled(running)).toBe(false)
    await clock.advance(20)
    expect(await running).toEqual(ok('fast'))
    expect(slow).toMatchObject({ finished: 0, cleaned: 1 })
    expect(clock.pending()).toBe(0)
  })

  it('a failure that settles first wins too', async () => {
    const { clock, env } = setup()
    const running = T.run(T.race([T.sleep(100), T.flatMap(() => T.fail('first'))(T.sleep(1))]), env)
    await clock.advance(1)
    expect(await running).toEqual(failed('first'))
  })

  it('with no contestants never completes, and is interrupted with its caller', async () => {
    const controller = new AbortController()
    const empty = T.run(T.race([]), undefined, controller.signal)
    expect(await isSettled(empty)).toBe(false)
    controller.abort()
    expect(await empty).toEqual(interrupted)

    const { clock, env } = setup()
    const outer = new AbortController()
    const work = probe(100)
    const running = T.run(T.race([work.task, T.never]), env, outer.signal)
    await clock.advance(1)
    outer.abort()
    expect(await running).toEqual(interrupted)
    expect(work.cleaned).toBe(1)
  })
})

describe('scoped', () => {
  it('interrupts and awaits forked fibers when the body ends, then runs finalizers in reverse', async () => {
    const { clock, env } = setup()
    const order: string[] = []
    const background = probe(1_000, 'bg', 10)
    const running = T.run(
      T.scoped((scope) =>
        T.gen(function* () {
          yield* scope.addFinalizer(T.sync(() => order.push('first registered')))
          yield* scope.addFinalizer(T.sync(() => order.push('second registered')))
          yield* scope.fork(background.task)
          yield* T.sleep(5)
          return 'body'
        }),
      ),
      env,
    )
    await clock.advance(5)
    expect(await isSettled(running)).toBe(false)
    expect(order).toEqual([])
    await clock.advance(10)
    expect(await running).toEqual(ok('body'))
    expect(background).toMatchObject({ started: 1, finished: 0, cleaned: 1 })
    expect(order).toEqual(['second registered', 'first registered'])
  })

  it('join adopts a fiber’s outcome and interrupt stops one fiber', async () => {
    const { clock, env } = setup()
    const running = T.run(
      T.scoped((scope) =>
        T.gen(function* () {
          const quick = yield* scope.fork(T.as('quick')(T.sleep(5)))
          const failing = yield* scope.fork(T.fail('fiber failed'))
          const endless = yield* scope.fork(T.sleep(10_000))
          const value = yield* quick.join
          const failure = yield* T.result(failing.join)
          yield* endless.interrupt
          const stopped = yield* T.exit(endless.join)
          return { value, failure, stopped, exit: yield* T.promise(() => endless.exit) }
        }),
      ),
      env,
    )
    await clock.advance(5)
    expect(await running).toEqual(
      ok({ value: 'quick', failure: err('fiber failed'), stopped: interrupted, exit: interrupted }),
    )
    expect(clock.pending()).toBe(0)
  })

  it('a fiber forking another during shutdown is still awaited', async () => {
    const { clock, env } = setup()
    const late = probe(10_000, 'late')
    const running = T.run(
      T.scoped((scope) =>
        T.gen(function* () {
          yield* scope.fork(
            T.gen(function* () {
              try {
                yield* T.sleep(10_000)
              } finally {
                yield* scope.fork(late.task)
              }
            }),
          )
          yield* T.sleep(1)
        }),
      ),
      env,
    )
    await clock.advance(1)
    expect(await running).toEqual(ok(undefined))
    expect(late.started).toBeLessThanOrEqual(1)
    expect(clock.pending()).toBe(0)
  })

  it('keeps the body’s failure, reports a failing finalizer after success, and survives a throwing body', async () => {
    const failing = T.scoped((scope) =>
      T.flatMap(() => T.fail('body'))(scope.addFinalizer(T.die('finalizer'))),
    )
    expect(await T.run(failing)).toEqual(failed('body'))
    const succeeding = T.scoped((scope) => T.as(1)(scope.addFinalizer(T.die('finalizer'))))
    expect(await T.run(succeeding)).toEqual(died('finalizer'))
    const boom = new Error('body threw')
    expect(
      await T.run(
        T.scoped(() => {
          throw boom
        }),
      ),
    ).toEqual(died(boom))
    expect(
      await T.run(
        T.scoped(() => T.succeed(1)),
        undefined,
        aborted(),
      ),
    ).toEqual(interrupted)
  })

  it('interrupting the caller interrupts the body and every fiber', async () => {
    const { clock, env } = setup()
    const controller = new AbortController()
    const fiber = probe(1_000)
    const running = T.run(
      T.scoped((scope) => T.flatMap(() => T.sleep(1_000))(scope.fork(fiber.task))),
      env,
      controller.signal,
    )
    await clock.advance(1)
    controller.abort()
    expect(await running).toEqual(interrupted)
    expect(fiber.cleaned).toBe(1)
  })
})

describe('time', () => {
  it('now and sleep use the clock in the environment', async () => {
    const { clock, env } = setup(1_000)
    const running = T.run(
      T.gen(function* () {
        const before = yield* T.now
        yield* T.sleep(250)
        return (yield* T.now) - before
      }),
      env,
    )
    await clock.advance(249)
    expect(await isSettled(running)).toBe(false)
    await clock.advance(1)
    expect(await running).toEqual(ok(250))
    expect(await T.run(T.Clock, env)).toEqual(ok(clock))
  })

  it('sleep is interruptible', async () => {
    const { clock, env } = setup()
    const controller = new AbortController()
    const running = T.run(T.sleep(100), env, controller.signal)
    await clock.flush()
    controller.abort()
    expect(await running).toEqual(interrupted)
    expect(clock.pending()).toBe(0)
  })

  it('timeout fails with TimeoutError and interrupts the task, or lets a fast task through', async () => {
    const { clock, env } = setup()
    const slow = probe(1_000)
    const late = T.run(T.timeout(100)(slow.task), env)
    await clock.advance(100)
    expect(await late).toEqual(failed(T.TimeoutError({ ms: 100 })))
    expect(slow).toMatchObject({ finished: 0, cleaned: 1 })
    const fast = T.run(T.timeout(100)(T.as('ok')(T.sleep(99))), env)
    await clock.advance(99)
    expect(await fast).toEqual(ok('ok'))
    expect(clock.pending()).toBe(0)
  })

  it('retry sleeps through the schedule and stops when it is exhausted', async () => {
    const { clock, env } = setup()
    let attempts = 0
    const flaky = T.suspend(() => (++attempts < 3 ? T.fail(`attempt ${attempts}`) : T.succeed(attempts)))
    const running = T.run(T.retry({ schedule: () => Schedule.exponential(10) })(flaky), env)
    await clock.advance(10)
    expect(attempts).toBe(2)
    await clock.advance(20)
    expect(await running).toEqual(ok(3))

    let tries = 0
    const hopeless = T.suspend(() => T.fail(`try ${++tries}`))
    const exhausted = T.run(
      T.retry({ schedule: () => pipe(Schedule.spaced(5), Iter.take(2)) })(hopeless),
      env,
    )
    await clock.advance(10)
    expect(await exhausted).toEqual(failed('try 3'))
  })

  it('retry respects its predicate, passes defects through, closes its schedule and is interruptible', async () => {
    const { clock, env } = setup()
    let closed = 0
    const schedule = () => ({
      [Symbol.iterator]: () => ({
        next: () => ({ done: false, value: 10 }),
        return: () => {
          closed++
          return { done: true as const, value: undefined }
        },
      }),
    })
    const never = T.retry({ schedule, while: (e: string) => e !== 'fatal' })(T.fail('fatal'))
    expect(await T.run(never, env)).toEqual(failed('fatal'))
    expect(await T.run(T.retry({ schedule })(T.die('d')), env)).toEqual(died('d'))
    expect(closed).toBe(2)

    const controller = new AbortController()
    const waiting = T.run(T.retry({ schedule })(T.fail('again')), env, controller.signal)
    await clock.flush()
    controller.abort()
    expect(await waiting).toEqual(interrupted)
    expect(closed).toBe(3)
    expect(await T.run(T.retry({ schedule: () => [] })(T.fail('once')), env)).toEqual(failed('once'))
  })

  it('forever repeats with a pause until failure or interruption', async () => {
    const { clock, env } = setup()
    let runs = 0
    const failing = T.run(T.forever(10)(T.suspend(() => (++runs < 3 ? T.unit : T.fail('stop')))), env)
    await clock.advance(20)
    expect(await failing).toEqual(failed('stop'))
    expect(runs).toBe(3)

    const controller = new AbortController()
    let ticks = 0
    const ticking = T.run(T.forever(10)(T.sync(() => ticks++)), env, controller.signal)
    await clock.advance(25)
    controller.abort()
    expect(await ticking).toEqual(interrupted)
    expect(ticks).toBe(3)
  })
})

describe('running', () => {
  it('runPromise resolves with the value or rejects with a TaskError carrying the cause', async () => {
    expect(await T.runPromise(T.succeed(1))).toBe(1)
    await expect(T.runPromise(T.fail({ code: 7 }))).rejects.toMatchObject({
      name: 'TaskError',
      message: 'Task failed: {"code":7}',
      cause: T.failCause({ code: 7 }),
    })
    await expect(T.runPromise(T.die(new Error('bug')))).rejects.toThrow('Task died: bug')
    await expect(T.runPromise(T.die('plain'))).rejects.toThrow('Task died: "plain"')
    await expect(T.runPromise(T.interrupt)).rejects.toThrow('Task interrupted')
  })

  it('TaskError describes values that JSON cannot', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(new T.TaskError(T.failCause(circular)).message).toBe('Task failed: [object Object]')
    expect(new T.TaskError(T.failCause(undefined)).message).toBe('Task failed: undefined')
    expect(new T.TaskError(T.dieCause(1n)).message).toBe('Task died: 1')
  })

  it('runFork hands back a handle that interrupts and detaches from the outer signal', async () => {
    const { clock, env } = setup()
    const work = probe(1_000)
    const handle = T.runFork(work.task, env)
    await clock.advance(1)
    expect(await handle.interrupt()).toEqual(interrupted)
    expect(await handle.exit).toEqual(interrupted)
    expect(work.cleaned).toBe(1)

    const outer = new AbortController()
    const listeners = trackListeners(outer.signal)
    const quick = T.runFork(T.succeed(1), undefined, outer.signal)
    expect(await quick.exit).toEqual(ok(1))
    expect(listeners()).toBe(0)
    const stopped = T.runFork(T.never, undefined, outer.signal)
    outer.abort()
    expect(await stopped.exit).toEqual(interrupted)
    expect(await T.runFork(T.succeed(2), undefined, aborted()).exit).toEqual(interrupted)
  })

  it('requires an environment exactly when the task has requirements', () => {
    // @ts-expect-error a task that needs a clock cannot run without one
    void T.run(T.sleep(1))
    const clock: Clock = makeTestClock()
    void T.run(T.now, { clock })
  })
})

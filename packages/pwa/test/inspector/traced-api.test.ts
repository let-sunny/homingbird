import { type Fetch, httpApi } from '@homingbird/client'
import { Task as T, makeTestClock } from '@homingbird/kernel'
import { type Api, type ApiError, contract } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { createRecording } from '../../src/inspector/recording.ts'
import { tracedApi } from '../../src/inspector/traced-api.ts'

const noFetch: Fetch = () => Promise.reject(new Error('no network in unit tests'))

type Routes = Readonly<Record<string, (request: unknown) => T.Task<unknown, ApiError>>>

const traced = (routes: Routes) => {
  const clock = makeTestClock(0)
  const recording = createRecording(clock)
  const api = tracedApi(() => routes as unknown as Api, noFetch, recording) as unknown as Routes
  return { api, clock, recording, timeline: () => recording.snapshot().timeline }
}

describe('tracedApi', () => {
  it('records any route there is, the one added a moment ago too', async () => {
    const { api, timeline } = traced({ 'brand.new': () => T.succeed('SECRET') })
    expect(await T.runPromise(api['brand.new']!({}) as T.Task<string>)).toBe('SECRET')
    expect(timeline()).toEqual([
      { kind: 'request', number: 0, at: 0, route: 'brand.new', ms: 0, outcome: 'ok', status: null },
    ])
  })

  it('traces every route of the contract, and gives what the route gives', async () => {
    const recording = createRecording(makeTestClock(0))
    const answers: Fetch = () => Promise.resolve(new Response('{}', { status: 418 }))
    const api = tracedApi((fetch) => httpApi({ serverUrl: 'http://x', fetch }), answers, recording)
    for (const route of Object.keys(contract)) {
      recording.clear()
      const exit = await T.run(
        (api as unknown as Routes)[route]!({ params: new Proxy({}, { get: () => 'SECRET' }) }),
      )
      expect(exit._tag).toBe('Err')
      expect(recording.snapshot().timeline).toMatchObject([{ route, outcome: 'Unavailable', status: 418 }])
    }
  })

  it('records a slow request while it runs, how long it took, and one that ended with its page', async () => {
    const { api, clock, timeline } = traced({
      slow: () => T.make<unknown, ApiError>((_, signal) => T.sleep(900).run({ clock }, signal)),
    })
    const ending = new AbortController()
    void T.run(api.slow!({}))
    void T.run(api.slow!({}), {}, ending.signal)
    expect(timeline()).toMatchObject([{ outcome: 'pending' }, { outcome: 'pending' }])
    await clock.advance(400)
    ending.abort()
    await clock.advance(500)
    expect(timeline()).toMatchObject([
      { outcome: 'ok', ms: 900 },
      { outcome: 'interrupted', ms: 400 },
    ])
  })

  it('records a refusal by its tag, and a defect as broken, and passes both on', async () => {
    const refusal: ApiError = { _tag: 'Conflict', message: 'SECRET' }
    const { api, timeline } = traced({ refused: () => T.fail(refusal), breaks: () => T.die('SECRET') })
    expect(await T.run(api.refused!({}))).toMatchObject({ error: { _tag: 'Fail', error: refusal } })
    expect(await T.run(api.breaks!({}))).toMatchObject({ error: { _tag: 'Die', defect: 'SECRET' } })
    expect(timeline()).toMatchObject([{ outcome: 'Conflict' }, { outcome: 'broke' }])
  })

  it('records nothing of a name the API does not have', () => {
    const { api, timeline } = traced({})
    expect(api.SECRET).toBeUndefined()
    expect(timeline()).toEqual([])
  })
})

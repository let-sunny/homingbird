import { Task as T, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { type DeviceAuthorization, awaitDeviceTokens, beginDeviceFlow } from '../src/device-flow.ts'
import type { Fetch } from '../src/http-api.ts'

const authorization: DeviceAuthorization = {
  device_code: 'device-code',
  user_code: 'BCDF-GHJK',
  verification_uri: 'https://hb.test/#/device',
  verification_uri_complete: 'https://hb.test/#/device/BCDF-GHJK',
  expires_in: 30,
  interval: 5,
}

const scripted = (answers: ReadonlyArray<readonly [number, unknown]>) => {
  const calls: Array<{ url: string; body: string }> = []
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, body: String(init?.body) })
    const [status, body] = answers[Math.min(calls.length - 1, answers.length - 1)]!
    return new Response(JSON.stringify(body), { status })
  }
  return { fetch, calls }
}

const options = (fetch: Fetch) => ({
  serverUrl: 'https://hb.test/',
  clientName: 'Laptop',
  fetch,
})

describe('beginDeviceFlow', () => {
  it('asks for the notes scope, the only one a device can have', async () => {
    const { fetch, calls } = scripted([[200, authorization]])
    expect(await T.run(beginDeviceFlow(options(fetch)))).toMatchObject({ _tag: 'Ok', value: authorization })
    expect(calls).toEqual([
      { url: 'https://hb.test/oauth/device_authorization', body: 'client_name=Laptop&scope=notes' },
    ])
  })

  it('says which kind of program asks, when it is told', async () => {
    const { fetch, calls } = scripted([[200, authorization]])
    await T.run(beginDeviceFlow({ ...options(fetch), clientKind: 'mcp' }))
    expect(calls[0]!.body).toBe('client_name=Laptop&client_kind=mcp&scope=notes')
  })

  it('reports a server whose answer is not JSON as unreachable', async () => {
    const fetch: Fetch = async () => new Response('<html>', { status: 502 })
    expect(await T.run(beginDeviceFlow(options(fetch)))).toMatchObject({
      _tag: 'Err',
      error: { error: { _tag: 'DeviceFlowFailed', reason: 'unreachable' } },
    })
  })

  it('reports an unreachable server', async () => {
    const fetch: Fetch = async () => {
      throw new Error('offline')
    }
    expect(await T.run(beginDeviceFlow(options(fetch)))).toMatchObject({
      _tag: 'Err',
      error: { error: { _tag: 'DeviceFlowFailed', reason: 'unreachable' } },
    })
  })

  it('uses the global fetch when none is given', async () => {
    const original = globalThis.fetch
    const { fetch, calls } = scripted([[200, authorization]])
    globalThis.fetch = fetch as typeof globalThis.fetch
    try {
      await T.run(beginDeviceFlow({ serverUrl: 'https://hb.test', clientName: 'x' }))
      expect(calls).toHaveLength(1)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('awaitDeviceTokens', () => {
  const pending = [400, { error: 'authorization_pending' }] as const
  const tokens = { access_token: 'hba_x', expires_in: 3600 }

  it('polls at the given interval until the request is approved', async () => {
    const clock = makeTestClock()
    const { fetch, calls } = scripted([pending, [400, { error: 'slow_down' }], [200, tokens]])
    const running = T.run(awaitDeviceTokens(options(fetch), authorization), { clock })
    await clock.advance(4_999)
    expect(calls).toHaveLength(0)
    await clock.advance(1)
    expect(calls).toHaveLength(1)
    await clock.advance(10_000)
    expect(await running).toMatchObject({ _tag: 'Ok', value: tokens })
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({
      url: 'https://hb.test/oauth/token',
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&device_code=device-code',
    })
  })

  it('stops when the request is denied', async () => {
    const clock = makeTestClock()
    const { fetch } = scripted([pending, [400, { error: 'access_denied' }]])
    const running = T.run(awaitDeviceTokens(options(fetch), authorization), { clock })
    await clock.advance(10_000)
    expect(await running).toMatchObject({ _tag: 'Err', error: { error: { reason: 'denied' } } })
  })

  it('gives up when the code expires', async () => {
    const clock = makeTestClock()
    const { fetch, calls } = scripted([pending])
    const running = T.run(awaitDeviceTokens(options(fetch), authorization), { clock })
    await clock.advance(30_000)
    expect(await running).toMatchObject({ _tag: 'Err', error: { error: { reason: 'expired' } } })
    expect(calls).toHaveLength(6)
    expect(clock.pending()).toBe(0)
  })

  it('gives up on an answer it does not understand', async () => {
    const clock = makeTestClock()
    const { fetch, calls } = scripted([[400, { error: 'expired_token' }]])
    const running = T.run(awaitDeviceTokens(options(fetch), authorization), { clock })
    await clock.advance(5_000)
    expect(await running).toMatchObject({ _tag: 'Err', error: { error: { reason: 'expired' } } })
    expect(calls).toHaveLength(1)
  })

  it('can be interrupted while waiting, leaving no timer behind', async () => {
    const clock = makeTestClock()
    const { fetch, calls } = scripted([pending])
    const stop = new AbortController()
    const running = T.run(awaitDeviceTokens(options(fetch), authorization), { clock }, stop.signal)
    await clock.advance(1_000)
    stop.abort()
    expect(await running).toMatchObject({ _tag: 'Err', error: { _tag: 'Interrupt' } })
    expect(calls).toHaveLength(0)
    expect(clock.pending()).toBe(0)
  })
})

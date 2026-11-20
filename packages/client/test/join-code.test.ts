import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import type { Fetch } from '../src/http-api.ts'
import { redeemJoinCode } from '../src/join-code.ts'

const answering = (status: number, body: unknown) => {
  const calls: Array<{ url: string; body: string }> = []
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, body: String(init?.body) })
    return new Response(JSON.stringify(body), { status })
  }
  return { fetch, calls }
}

const options = (fetch: Fetch) => ({
  serverUrl: 'https://hb.test/',
  code: 'hbj_code',
  clientName: 'build-1',
  clientKind: 'cli' as const,
  fetch,
})

const refusal = async (status: number, body: unknown) =>
  T.run(redeemJoinCode(options(answering(status, body).fetch)))

describe('redeemJoinCode', () => {
  it('sends the code, the name and the kind of program, and returns the tokens', async () => {
    const { fetch, calls } = answering(200, { access_token: 'hba_token', expires_in: 60 })
    expect(await T.run(redeemJoinCode(options(fetch)))).toMatchObject({
      _tag: 'Ok',
      value: { access_token: 'hba_token' },
    })
    expect(calls).toEqual([
      { url: 'https://hb.test/oauth/join', body: 'code=hbj_code&client_name=build-1&client_kind=cli' },
    ])
  })

  it('leaves out the kind of program when it is not told', async () => {
    const { fetch, calls } = answering(200, { access_token: 'hba_token', expires_in: 60 })
    const { clientKind: _, ...withoutKind } = options(fetch)
    await T.run(redeemJoinCode(withoutKind))
    expect(calls[0]!.body).toBe('code=hbj_code&client_name=build-1')
  })

  it('passes on the server’s reason for a refused code', async () => {
    expect(await refusal(400, { error: 'invalid_grant', error_description: 'Expired.' })).toMatchObject({
      _tag: 'Err',
      error: { error: { _tag: 'JoinCodeRefused', reason: 'refused', message: 'Expired.' } },
    })
    expect(await refusal(400, {})).toMatchObject({
      error: { error: { reason: 'refused', message: expect.stringMatching(/Create a new one/) } },
    })
    expect(await refusal(200, {})).toMatchObject({ error: { error: { reason: 'refused' } } })
  })

  it('says when too many codes were tried, and when the server offers none', async () => {
    expect(await refusal(429, {})).toMatchObject({ error: { error: { reason: 'too_many' } } })
    expect(await refusal(404, {})).toMatchObject({
      error: { error: { reason: 'off', message: expect.stringMatching(/homingbird login/) } },
    })
  })

  it('reports an unreachable server and an answer that is not JSON alike', async () => {
    const offline: Fetch = async () => {
      throw new Error('offline')
    }
    const html: Fetch = async () => new Response('<html>', { status: 502 })
    for (const fetch of [offline, html])
      expect(await T.run(redeemJoinCode(options(fetch)))).toMatchObject({
        error: { error: { reason: 'unreachable' } },
      })
  })
})

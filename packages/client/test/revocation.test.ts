import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { isRevokedOnServer } from '../src/revocation.ts'

describe('revoking a credential on the server', () => {
  it('posts the token as a form to /oauth/revoke and believes only a confirmation', async () => {
    const asked: Array<{ url: string; body: string }> = []
    const answering =
      (status: number) =>
      async (url: string, init?: RequestInit): Promise<Response> => {
        asked.push({ url, body: String(init?.body) })
        return new Response('{}', { status })
      }
    expect(
      await T.runPromise(isRevokedOnServer(answering(200), 'https://hb.example.com', 'hba_secret')),
    ).toBe(true)
    expect(asked).toEqual([{ url: 'https://hb.example.com/oauth/revoke', body: 'token=hba_secret' }])
    expect(await T.runPromise(isRevokedOnServer(answering(400), 'https://hb.example.com', 'x'))).toBe(false)
  })

  it('confirms nothing when the server cannot be reached', async () => {
    const unreachable = async (): Promise<Response> => {
      throw new TypeError('fetch failed')
    }
    expect(await T.runPromise(isRevokedOnServer(unreachable, 'https://hb.example.com', 'x'))).toBe(false)
  })
})

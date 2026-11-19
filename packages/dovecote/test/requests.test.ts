import { Task as T } from '@homingbird/kernel'
import type { MemberId } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  advanceAuthRequest,
  authRequestById,
  authRequestBySecret,
  authRequestByUserCode,
  deleteExpiredAuthRequests,
  openAuthRequest,
} from '../src/auth/requests.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer

beforeEach(async () => {
  server = await startTestServer()
})

afterEach(() => server.close())

const running = <A>(task: T.Task<A, never, TestServer['env']>) => T.runPromise(task, server.env)

describe('an authorization request', () => {
  it('is found by id, secret or user code while it lives, and stores only a hash of its secret', async () => {
    const opened = await running(
      openAuthRequest({
        kind: 'device',
        detail: { client: 'CLI' },
        lifetimeMs: 60_000,
        secret: 'device-secret',
        userCode: 'BCDF-GHJK',
      }),
    )
    expect(opened).toMatchObject({
      status: 'pending',
      memberId: null,
      expiresAt: server.clock.now() + 60_000,
    })
    expect(await running(authRequestById('device', opened.id))).toEqual(opened)
    expect(await running(authRequestBySecret('device', 'device-secret'))).toEqual(opened)
    expect(await running(authRequestByUserCode('BCDF-GHJK'))).toEqual(opened)
    expect(await running(authRequestById('authorize', opened.id))).toBeNull()
    expect(JSON.stringify(await storedRows(server, 'auth_requests'))).not.toContain('device-secret')
    await server.clock.advance(60_000)
    expect(await running(authRequestById('device', opened.id))).toBeNull()
  })

  it('moves on only from the status it is expected to be in, so two decisions cannot both win', async () => {
    const opened = await running(openAuthRequest({ kind: 'authorize', detail: { a: 1 }, lifetimeMs: 60_000 }))
    const approve = {
      status: 'approved',
      expectedStatus: 'pending',
      memberId: 'mem_ana' as MemberId,
      secret: 'code',
      detail: { a: 2 },
    } as const
    expect(await running(advanceAuthRequest(opened.id, approve))).toBe(true)
    expect(
      await running(advanceAuthRequest(opened.id, { status: 'denied', expectedStatus: 'pending' })),
    ).toBe(false)
    expect(await running(authRequestBySecret('authorize', 'code'))).toMatchObject({
      status: 'approved',
      memberId: 'mem_ana' as MemberId,
      detail: { a: 2 },
    })
  })

  it('is deleted once expired by the housekeeping pass, and not before', async () => {
    await running(openAuthRequest({ kind: 'sign_in', detail: {}, lifetimeMs: 1_000 }))
    await running(openAuthRequest({ kind: 'sign_in', detail: {}, lifetimeMs: 10_000 }))
    expect(await running(deleteExpiredAuthRequests(server.clock.now() + 5_000))).toBe(1)
    expect(await storedRows(server, 'auth_requests')).toHaveLength(1)
  })
})

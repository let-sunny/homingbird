import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleRequest } from '../src/http/app.ts'
import { type TestServer, startTestServer } from './harness.ts'

let server: TestServer

beforeEach(async () => {
  server = await startTestServer({ HB_LOGS: 'requests=on,operational=info' })
})

afterEach(() => server.close())

describe('answering a request', () => {
  it('answers the health check without signing in, under a request id of its own', async () => {
    const first = await server.request('GET', '/healthz')
    const second = await server.request('GET', '/healthz')
    expect([first.status, first.json]).toEqual([200, { status: 'ok' }])
    expect(first.headers['x-request-id']).toMatch(/^req_[0-9a-z]{20}$/)
    expect(second.headers['x-request-id']).not.toBe(first.headers['x-request-id'])
  })

  it('logs a request by its route name, never by a path that can carry a code', async () => {
    await server.request('GET', '/oauth/authorize?code=supersecret')
    await server.request('GET', '/api/v1/notes/note_abcdefghij0123456789')
    const lines = server.logged.join('\n')
    expect(lines).toContain('"route":"oauth"')
    expect(lines).toContain('"route":"notes.get"')
    expect(lines).not.toContain('supersecret')
    expect(lines).not.toContain('note_abcdefghij0123456789')
  })

  it('lets other origins reach the OAuth and agent endpoints, and answers their preflight', async () => {
    const preflight = await server.request('OPTIONS', '/oauth/token')
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('*')
    expect((await server.request('GET', '/.well-known/oauth-authorization-server')).headers).toMatchObject({
      'access-control-allow-origin': '*',
    })
    expect(
      (await server.request('GET', '/api/v1/info')).headers['access-control-allow-origin'],
    ).toBeUndefined()
  })

  it('answers a defect with a 500 that says nothing about it, and logs it by name', async () => {
    const failing = () => T.die(new Error('disk on fire'))
    const database = { ...server.env.database, all: failing, run: failing, transaction: failing }
    const env = { ...server.env, database, connection: database }
    const exit = await T.runPromise(
      handleRequest({
        method: 'GET',
        path: '/api/v1/info',
        query: new URLSearchParams(),
        headers: {},
        body: '',
        remoteAddress: '127.0.0.1',
        disconnected: new AbortController().signal,
      }),
      env,
    )
    expect(exit.status).toBe(500)
    expect(exit.body).not.toContain('disk on fire')
    expect(server.logged.join('\n')).toContain('http.request_failed')
  })
})

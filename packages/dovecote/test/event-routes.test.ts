import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resumePoint, tokenOf } from '../src/http/event-routes.ts'
import type { HttpRequest } from '../src/http/exchange.ts'
import { type Session, type TestServer, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
})

afterEach(() => server?.close())

const request = (headers: Record<string, string>, query = ''): HttpRequest => ({
  method: 'GET',
  path: '/api/v1/events/stream',
  query: new URLSearchParams(query),
  headers,
  body: '',
  remoteAddress: '127.0.0.1',
  disconnected: new AbortController().signal,
})

describe('the event stream route', () => {
  it('resumes after the last event the browser saw, or the one a client names, and only from a number', () => {
    expect(resumePoint(request({ 'last-event-id': '41' }, 'after=7'))).toBe(41)
    expect(resumePoint(request({}, 'after=7'))).toBe(7)
    expect(resumePoint(request({}))).toBeNull()
    expect(resumePoint(request({ 'last-event-id': '-1' }))).toBeNull()
    expect(resumePoint(request({ 'last-event-id': '1'.repeat(16) }))).toBeNull()
  })

  it('reads the token from the bearer header first, then from the session cookie', () => {
    expect(tokenOf(request({ authorization: 'Bearer hba_1', cookie: 'hb_session=hbh_2' }))).toBe('hba_1')
    expect(tokenOf(request({ cookie: 'theme=dark; hb_session=hbh_2' }))).toBe('hbh_2')
    expect(tokenOf(request({}))).toBeNull()
  })

  it('opens a stream of server-sent events for a signed-in caller, and refuses anyone else', async () => {
    const open = new AbortController()
    const stream = await server.request('GET', '/api/v1/events/stream', {
      token: ana.token,
      signal: open.signal,
    })
    expect(stream.status).toBe(200)
    expect(stream.headers).toMatchObject({
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    })
    open.abort()
    expect((await server.request('GET', '/api/v1/events/stream')).status).toBe(401)
    expect((await server.request('GET', '/api/v1/events/stream', { token: 'hbh_forged' })).status).toBe(401)
  })
})

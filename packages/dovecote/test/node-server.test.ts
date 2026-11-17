import { connect } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type RunningServer, startServer } from '../src/http/node-server.ts'
import { OPCODE, decodeClientFrames, encodeFrame } from '../src/http/websocket.ts'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'
import { maskedFrame } from './websocket-support.ts'

let server: TestServer
let listening: RunningServer
let origin: string
let ana: Session
let ben: Session
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer({ HB_TRUST_PROXY: '1' })
  listening = await startServer(server.env, 0)
  origin = `http://127.0.0.1:${listening.port}`
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  benAgent = await connectAgent(server, ben)
})

afterEach(async () => {
  await listening.close()
  await server.close()
})

const sendNote = async (body: string) => {
  const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body })).json
  await ana.api('POST', `/drafts/${draft.id}/send`, {})
}

const upgrade = (headers: Record<string, string>, path = '/api/v1/events/ws?after=0') =>
  new Promise<{ head: string; frames: () => Buffer[]; socket: ReturnType<typeof connect>; closed: Promise<void> }>((resolve) => {
    const socket = connect(listening.port, '127.0.0.1')
    let received = Buffer.alloc(0)
    let head: string | null = null
    const closed = new Promise<void>((done) => socket.on('close', () => done()))
    socket.on('error', () => {})
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk])
      const end = received.indexOf('\r\n\r\n')
      if (head === null && end !== -1) {
        head = received.subarray(0, end).toString()
        received = received.subarray(end + 4)
        resolve({ head, socket, closed, frames: () => serverFrames(received) })
      }
    })
    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n${Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join('')}\r\n`,
    )
  })

const serverFrames = (bytes: Buffer): Buffer[] => {
  const frames: Buffer[] = []
  let offset = 0
  while (offset + 2 <= bytes.length) {
    const short = bytes[offset + 1]! & 0x7f
    const lengthBytes = short === 126 ? 2 : short === 127 ? 8 : 0
    const length = short === 126 ? bytes.readUInt16BE(offset + 2) : short === 127 ? Number(bytes.readBigUInt64BE(offset + 2)) : short
    const start = offset + 2 + lengthBytes
    if (start + length > bytes.length) break
    frames.push(Buffer.concat([Buffer.from([bytes[offset]! & 0x0f]), bytes.subarray(start, start + length)]))
    offset = start + length
  }
  return frames
}

const until = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise((r) => setTimeout(r, 5))
  expect(condition()).toBe(true)
}

describe('over a real socket', () => {
  it('serves the JSON API and the health check', async () => {
    expect(await (await fetch(`${origin}/healthz`)).json()).toEqual({ status: 'ok' })
    const me = await fetch(`${origin}/api/v1/me`, { headers: { authorization: `Bearer ${benAgent.token}` } })
    expect(((await me.json()) as any).member.email).toBe('ben@example.com')
    const created = await fetch(`${origin}/api/v1/drafts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${benAgent.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to: [ana.me.member.id], body: 'over the wire' }),
    })
    expect(((await created.json()) as any).body).toBe('over the wire')
    const invalid = await fetch(`${origin}/api/v1/drafts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${benAgent.token}`, 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(invalid.status).toBe(400)
    expect((await fetch(`${origin}/api/v1/nothing`)).status).toBe(404)
  })

  it('refuses a request body that is too large', async () => {
    const response = await fetch(`${origin}/api/v1/drafts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${benAgent.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x'.repeat(300 * 1024) }),
    }).catch(() => ({ status: 413 }))
    expect(response.status).toBe(413)
  })

  it('streams server-sent events until the client goes away', async () => {
    await sendNote('first')
    const hangUp = new AbortController()
    const response = await fetch(`${origin}/api/v1/events/stream?after=0`, {
      headers: { authorization: `Bearer ${benAgent.token}` },
      signal: hangUp.signal,
    })
    const reader = response.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('event: note.sent')
    expect(server.env.hub.presenceOf(ben.me.member.id).agentOnline).toBe(true)
    await sendNote('second')
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"second"')
    hangUp.abort()
    await until(() => !server.env.hub.presenceOf(ben.me.member.id).agentOnline)
  })

  it('upgrades to a WebSocket, delivers events as text frames, answers pings and closes cleanly', async () => {
    await sendNote('first')
    const ws = await upgrade({ authorization: `Bearer ${benAgent.token}`, 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' })
    expect(ws.head).toContain('101 Switching Protocols')
    expect(ws.head).toContain('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
    await until(() => ws.frames().length >= 1)
    const [replayed] = ws.frames()
    expect(replayed![0]).toBe(OPCODE.text)
    expect(JSON.parse(replayed!.subarray(1).toString())).toMatchObject({ seq: 1, body: { type: 'note.sent' } })

    await sendNote('second')
    await until(() => ws.frames().length >= 2)
    ws.socket.write(maskedFrame(OPCODE.ping, Buffer.from('hi')))
    await until(() => ws.frames().some((frame) => frame[0] === OPCODE.pong && frame.subarray(1).toString() === 'hi'))
    ws.socket.write(maskedFrame(OPCODE.close, Buffer.alloc(0)))
    await ws.closed
    await until(() => !server.env.hub.presenceOf(ben.me.member.id).agentOnline)
  })

  it('accepts a browser session cookie from its own origin only', async () => {
    const key = { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' }
    const own = await upgrade({ cookie: ben.cookie, origin: 'http://localhost:8080', ...key })
    expect(own.head).toContain('101')
    own.socket.destroy()
    const foreign = await upgrade({ cookie: ben.cookie, origin: 'https://evil.example', ...key })
    expect(foreign.head).toContain('401')
    expect((await upgrade(key)).head).toContain('401')
    expect((await upgrade({ authorization: `Bearer ${benAgent.token}` })).head).toContain('401')
    expect((await upgrade({ authorization: `Bearer ${benAgent.token}`, ...key }, '/api/v1/elsewhere')).head).toContain('401')
  })

  it('drops a client that sends an unmasked frame', async () => {
    const ws = await upgrade({ authorization: `Bearer ${benAgent.token}`, 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' })
    ws.socket.write(encodeFrame(OPCODE.text, Buffer.from('unmasked')))
    await ws.closed
    expect(decodeClientFrames(encodeFrame(OPCODE.text, Buffer.from('unmasked'))).violation).toBe(true)
  })

  it('rate-limits by the forwarded address when it trusts the proxy', async () => {
    const start = (address: string) =>
      fetch(`${origin}/oauth/device_authorization`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `${address}, 10.0.0.1` },
        body: 'client_name=x',
      })
    for (let attempt = 0; attempt < 30; attempt++) expect((await start('203.0.113.7')).status).toBe(200)
    expect((await start('203.0.113.7')).status).toBe(429)
    expect((await start('203.0.113.8')).status).toBe(200)
  })

  it('answers 500 without leaking details when a handler dies', async () => {
    await server.close()
    const response = await fetch(`${origin}/api/v1/info`)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { code: 'Unavailable', message: 'The server hit an unexpected error.' } })
    expect(server.logged.some((line) => line.startsWith('request failed: GET /api/v1/info'))).toBe(true)
    server = await startTestServer()
  })
})

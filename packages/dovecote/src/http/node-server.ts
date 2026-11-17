import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { Task as T } from '@homingbird/kernel'
import { STREAM_PATHS } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { handleRequest } from './app.ts'
import { callerOf } from './authenticate.ts'
import { HEARTBEAT, memberFeed, resumePoint, tokenOf } from './event-routes.ts'
import type { HttpRequest, HttpResponse } from './exchange.ts'
import { OPCODE, decodeClientFrames, encodeFrame, encodeText, handshakeResponse } from './websocket.ts'

export interface RunningServer {
  readonly port: number
  readonly close: () => Promise<void>
}

export const startServer = (env: AppEnv, port: number): Promise<RunningServer> =>
  new Promise((resolve) => {
    const open = new Set<AbortController>()
    const server: Server = createServer((incoming, outgoing) => void serve(env, incoming, outgoing, open))
    server.on('upgrade', (incoming, socket) => void serveWebSocket(env, incoming, socket, open))
    server.listen(port, () => {
      const address = server.address()
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : port,
        close: () =>
          new Promise<void>((closed) => {
            for (const connection of open) connection.abort()
            server.close(() => closed())
            server.closeAllConnections()
          }),
      })
    })
  })

const MAX_BODY_BYTES = 256 * 1024

const serve = async (
  env: AppEnv,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  open: Set<AbortController>,
): Promise<void> => {
  const connection = new AbortController()
  open.add(connection)
  outgoing.on('close', () => {
    connection.abort()
    open.delete(connection)
  })
  const body = await readBody(incoming)
  if (body === null) return void outgoing.writeHead(413).end()
  const exit = await T.run(
    handleRequest(toRequest(incoming, body, connection.signal, env.config.trustProxy)),
    env,
    connection.signal,
  )
  if (exit._tag === 'Ok') return write(outgoing, exit.value, connection.signal)
  if (exit.error._tag === 'Interrupt') return void outgoing.destroy()
  env.log(`request failed: ${incoming.method} ${incoming.url?.split('?')[0]}: ${describeDefect(exit.error)}`)
  if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' })
  outgoing.end(
    JSON.stringify({ error: { code: 'Unavailable', message: 'The server hit an unexpected error.' } }),
  )
}

const serveWebSocket = async (
  env: AppEnv,
  incoming: IncomingMessage,
  socket: Duplex,
  open: Set<AbortController>,
): Promise<void> => {
  const connection = new AbortController()
  const request = toRequest(incoming, '', connection.signal, env.config.trustProxy)
  const clientKey = request.headers['sec-websocket-key']
  const fromOurOrigin =
    request.headers.origin === undefined || request.headers.origin === new URL(env.config.publicUrl).origin
  const caller = await T.run(callerOf(request), env)
  const token = tokenOf(request)
  const accepted =
    request.path === STREAM_PATHS.ws &&
    clientKey !== undefined &&
    fromOurOrigin &&
    caller._tag === 'Ok' &&
    caller.value !== null
  if (!accepted || token === null)
    return void socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')

  open.add(connection)
  const hangUp = (): void => {
    connection.abort()
    open.delete(connection)
    socket.destroy()
  }
  socket.on('close', hangUp)
  socket.on('error', hangUp)
  let unread: Buffer = Buffer.alloc(0)
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeClientFrames(Buffer.concat([unread, chunk]))
    unread = decoded.remainder
    for (const frame of decoded.frames) {
      if (frame.opcode === OPCODE.ping) socket.write(encodeFrame(OPCODE.pong, frame.payload))
      if (frame.opcode === OPCODE.close) socket.end(encodeFrame(OPCODE.close, frame.payload))
    }
    if (decoded.violation) hangUp()
  })
  socket.write(handshakeResponse(clientKey))

  const feed = await T.run(memberFeed(caller.value!, token, resumePoint(request), connection.signal), env)
  if (feed._tag === 'Err') return hangUp()
  for await (const item of feed.value)
    socket.write(
      item === HEARTBEAT ? encodeFrame(OPCODE.ping, Buffer.alloc(0)) : encodeText(JSON.stringify(item)),
    )
  if (!socket.destroyed) socket.end(encodeFrame(OPCODE.close, Buffer.alloc(0)))
}

const toRequest = (
  incoming: IncomingMessage,
  body: string,
  disconnected: AbortSignal,
  trustProxy: boolean,
): HttpRequest => {
  const url = new URL(incoming.url ?? '/', 'http://dovecote.invalid')
  return {
    method: incoming.method ?? 'GET',
    path: url.pathname,
    query: url.searchParams,
    headers: Object.fromEntries(
      Object.entries(incoming.headers).map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(', ') : (value ?? ''),
      ]),
    ),
    body,
    remoteAddress: remoteAddressOf(incoming, trustProxy),
    disconnected,
  }
}

const remoteAddressOf = (incoming: IncomingMessage, trustProxy: boolean): string => {
  const forwarded = trustProxy
    ? String(incoming.headers['x-forwarded-for'] ?? '')
        .split(',')[0]
        ?.trim()
    : ''
  return forwarded || (incoming.socket.remoteAddress ?? 'unknown')
}

const readBody = async (incoming: IncomingMessage): Promise<string | null> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of incoming as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const write = async (
  outgoing: ServerResponse,
  response: HttpResponse,
  disconnected: AbortSignal,
): Promise<void> => {
  outgoing.writeHead(response.status, response.headers)
  if (typeof response.body === 'string' || response.body instanceof Uint8Array)
    return void outgoing.end(response.body)
  outgoing.flushHeaders()
  for await (const chunk of response.body) {
    if (disconnected.aborted) break
    if (!outgoing.write(chunk)) await new Promise((drained) => outgoing.once('drain', drained))
  }
  outgoing.end()
}

const describeDefect = (cause: { readonly _tag: string; readonly defect?: unknown }): string =>
  cause.defect instanceof Error
    ? (cause.defect.stack ?? cause.defect.message)
    : String(cause.defect ?? cause._tag)

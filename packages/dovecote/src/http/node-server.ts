import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { Stream, Task as T, isOk, ok } from '@homingbird/kernel'
import { STREAM_PATHS } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { defectNameOf, logDefect } from '../log/operational-log.ts'
import { handleRequest } from './app.ts'
import { callerOf } from './authenticate.ts'
import { type FeedItem, HEARTBEAT, memberFeed, resumePoint, tokenOf } from './event-routes.ts'
import type { HttpRequest, HttpResponse } from './exchange.ts'
import { clientAddressOf } from './forwarded-address.ts'
import { pongWatch, writeDrained } from './stalled-streams.ts'
import { OPCODE, decodeClientFrames, encodeFrame, encodeText, handshakeResponse } from './websocket.ts'

export interface RunningServer {
  readonly port: number
  readonly close: T.Task<void>
}

/** Serves Dovecote on the port; each request and WebSocket runs as a task of its own until its client leaves. */
export const startServer = (env: AppEnv, port: number): T.Task<RunningServer> =>
  T.async<RunningServer>((resume) => {
    const open = new Set<AbortController>()
    const server: Server = createServer((incoming, outgoing) => {
      void T.run(loggingDefects(env, serve(incoming, outgoing, open)), env)
    })
    server.on('upgrade', (incoming, socket) => {
      void T.run(loggingDefects(env, serveWebSocket(incoming, socket, open)), env)
    })
    server.listen(port, () => {
      const address = server.address()
      resume(
        ok({
          port: typeof address === 'object' && address !== null ? address.port : port,
          close: T.async<void>((closed) => {
            for (const connection of open) connection.abort()
            server.close(() => closed(ok(undefined)))
            server.closeAllConnections()
            return () => {}
          }),
        }),
      )
    })
    return () => server.close()
  })

const MAX_BODY_BYTES = 256 * 1024

const serve = (
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  open: Set<AbortController>,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const connection = new AbortController()
    open.add(connection)
    outgoing.on('close', () => {
      connection.abort()
      open.delete(connection)
    })
    const body = yield* readBody(incoming)
    if (body === null) return void outgoing.writeHead(413).end()
    const exit = yield* exitWhileConnected(
      handleRequest(toRequest(incoming, body, connection.signal, env.config.trustedProxies)),
      connection.signal,
    )
    if (exit._tag === 'Ok') return yield* write(outgoing, exit.value, connection)
    if (exit.error._tag === 'Interrupt') return void outgoing.destroy()
    logFailure(env, exit.error)
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' })
    outgoing.end(
      JSON.stringify({ error: { code: 'Unavailable', message: 'The server hit an unexpected error.' } }),
    )
  })

const serveWebSocket = (
  incoming: IncomingMessage,
  socket: Duplex,
  open: Set<AbortController>,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const connection = new AbortController()
    const request = toRequest(incoming, '', connection.signal, env.config.trustedProxies)
    const clientKey = request.headers['sec-websocket-key']
    const fromOurOrigin =
      request.headers.origin === undefined || request.headers.origin === new URL(env.config.publicUrl).origin
    const caller = yield* T.exit(callerOf(request))
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
    const pongs = pongWatch()
    let unread: Buffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      const decoded = decodeClientFrames(Buffer.concat([unread, chunk]))
      unread = decoded.remainder
      for (const frame of decoded.frames) {
        if (frame.opcode === OPCODE.ping) socket.write(encodeFrame(OPCODE.pong, frame.payload))
        if (frame.opcode === OPCODE.pong) pongs.ponged()
        if (frame.opcode === OPCODE.close) socket.end(encodeFrame(OPCODE.close, frame.payload))
      }
      if (decoded.violation) hangUp()
    })
    socket.write(handshakeResponse(clientKey))

    const feed = yield* T.exit(memberFeed(caller.value!, token, resumePoint(request), connection.signal))
    if (feed._tag === 'Err') return hangUp()
    const sent = yield* T.result(
      Stream.forEach((item: FeedItem) =>
        T.gen(function* () {
          if (item === HEARTBEAT) {
            if (pongs.isStalled()) return yield* T.fail(STALLED)
            pongs.pinged()
          }
          const frame =
            item === HEARTBEAT ? encodeFrame(OPCODE.ping, Buffer.alloc(0)) : encodeText(JSON.stringify(item))
          if (!(yield* isDrained(writeDrained(socket, frame), connection.signal)))
            return yield* T.fail(STALLED)
        }),
      )(feed.value),
    )
    if (!isOk(sent)) return hangUp()
    if (!socket.destroyed) socket.end(encodeFrame(OPCODE.close, Buffer.alloc(0)))
  })

const toRequest = (
  incoming: IncomingMessage,
  body: string,
  disconnected: AbortSignal,
  trustedProxies: number,
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
    remoteAddress: clientAddressOf(
      String(incoming.headers['x-forwarded-for'] ?? ''),
      incoming.socket.remoteAddress,
      trustedProxies,
    ),
    disconnected,
  }
}

const readBody = (incoming: IncomingMessage): T.Task<string | null> =>
  T.gen(function* () {
    const chunks: Buffer[] = []
    let size = 0
    const read = yield* T.result(
      Stream.forEach((chunk: Buffer) =>
        T.suspend(() => {
          size += chunk.length
          if (size > MAX_BODY_BYTES) return T.fail(TOO_LARGE)
          chunks.push(chunk)
          return T.unit
        }),
      )(incoming as AsyncIterable<Buffer>),
    )
    return isOk(read) ? Buffer.concat(chunks).toString('utf8') : null
  })

const write = (
  outgoing: ServerResponse,
  response: HttpResponse,
  connection: AbortController,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    outgoing.writeHead(response.status, response.headers)
    if (typeof response.body === 'string' || response.body instanceof Uint8Array)
      return void outgoing.end(response.body)
    outgoing.flushHeaders()
    const sent = yield* T.result(
      Stream.forEach((chunk: string | Uint8Array) =>
        T.gen(function* () {
          if (connection.signal.aborted) return yield* T.fail(LEFT)
          if (yield* isDrained(writeDrained(outgoing, chunk), connection.signal)) return
          connection.abort()
          outgoing.destroy()
          return yield* T.fail(STALLED)
        }),
      )(response.body),
    )
    if (isOk(sent) || sent.error === LEFT) outgoing.end()
  })

const isDrained = (
  written: ReturnType<typeof writeDrained>,
  signal: AbortSignal,
): T.Task<boolean, never, AppEnv> =>
  T.map((exit: T.Exit<boolean, never>) => exit._tag === 'Ok' && exit.value)(
    exitWhileConnected(written, signal),
  )

/** Runs the task until the client leaves, and gives how it ended, interrupted when the client left first. */
const exitWhileConnected = <A, E>(
  task: T.Task<A, E, AppEnv>,
  signal: AbortSignal,
): T.Task<T.Exit<A, E>, never, AppEnv> =>
  T.flatMap((env: AppEnv) => T.promise(() => T.run(task, env, signal)))(T.ask<AppEnv>())

/** A request that dies outside its handler, as when its client resets the upload, is logged, never thrown. */
const loggingDefects = (env: AppEnv, task: T.Task<void, never, AppEnv>): T.Task<void, never, AppEnv> =>
  T.map((exit: T.Exit<void, never>) => {
    if (exit._tag === 'Err') logFailure(env, exit.error)
  })(T.exit(task))

const logFailure = (env: AppEnv, cause: { readonly _tag: string; readonly defect?: unknown }): void => {
  const defect = cause._tag === 'Die' ? cause.defect : cause
  logDefect(
    env.log,
    {
      name: 'http.request_failed',
      attributes: { route: 'unknown', method: 'OTHER', defect: defectNameOf(defect) },
    },
    defect,
  )
}

const STALLED = Symbol('stalled')

const LEFT = Symbol('left')

const TOO_LARGE = Symbol('too large')

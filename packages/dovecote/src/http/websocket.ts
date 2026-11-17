import { createHash } from 'node:crypto'

export interface Frame {
  readonly opcode: number
  readonly payload: Buffer
}

export const OPCODE = { text: 0x1, close: 0x8, ping: 0x9, pong: 0xa } as const

export const acceptKeyFor = (clientKey: string): string =>
  createHash('sha1').update(`${clientKey}${HANDSHAKE_GUID}`).digest('base64')

export const handshakeResponse = (clientKey: string): string =>
  [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKeyFor(clientKey)}`,
    '',
    '',
  ].join('\r\n')

export const encodeFrame = (opcode: number, payload: Buffer): Buffer => {
  const header =
    payload.length < 126
      ? Buffer.from([FIN | opcode, payload.length])
      : payload.length < 65_536
        ? Buffer.from([FIN | opcode, 126, payload.length >> 8, payload.length & 0xff])
        : Buffer.concat([Buffer.from([FIN | opcode, 127]), uint64(payload.length)])
  return Buffer.concat([header, payload])
}

export const encodeText = (text: string): Buffer => encodeFrame(OPCODE.text, Buffer.from(text, 'utf8'))

export interface Decoded {
  readonly frames: ReadonlyArray<Frame>
  readonly remainder: Buffer
  readonly violation: boolean
}

export const decodeClientFrames = (buffer: Buffer): Decoded => {
  const frames: Frame[] = []
  let offset = 0
  for (;;) {
    const frame = clientFrameAt(buffer, offset)
    if (frame === 'incomplete') return { frames, remainder: buffer.subarray(offset), violation: false }
    if (frame === 'violation') return { frames, remainder: Buffer.alloc(0), violation: true }
    frames.push(frame.frame)
    offset = frame.end
  }
}

const HANDSHAKE_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const FIN = 0x80
const MASKED = 0x80
const MAX_CLIENT_PAYLOAD = 64 * 1024

const uint64 = (value: number): Buffer => {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64BE(BigInt(value))
  return bytes
}

const clientFrameAt = (
  buffer: Buffer,
  start: number,
): { readonly frame: Frame; readonly end: number } | 'incomplete' | 'violation' => {
  if (buffer.length - start < 2) return 'incomplete'
  const first = buffer[start]!
  const second = buffer[start + 1]!
  if ((second & MASKED) === 0) return 'violation'
  const shortLength = second & 0x7f
  const lengthBytes = shortLength === 126 ? 2 : shortLength === 127 ? 8 : 0
  const maskStart = start + 2 + lengthBytes
  if (buffer.length < maskStart + 4) return 'incomplete'
  const length =
    shortLength === 126
      ? buffer.readUInt16BE(start + 2)
      : shortLength === 127
        ? Number(buffer.readBigUInt64BE(start + 2))
        : shortLength
  if (length > MAX_CLIENT_PAYLOAD) return 'violation'
  const payloadStart = maskStart + 4
  if (buffer.length < payloadStart + length) return 'incomplete'
  const mask = buffer.subarray(maskStart, payloadStart)
  const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length))
  for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!
  return { frame: { opcode: first & 0x0f, payload }, end: payloadStart + length }
}

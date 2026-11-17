import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  OPCODE,
  acceptKeyFor,
  decodeClientFrames,
  encodeFrame,
  encodeText,
  handshakeResponse,
} from '../src/http/websocket.ts'
import { maskedFrame } from './websocket-support.ts'

describe('the WebSocket handshake', () => {
  it('derives the accept key of RFC 6455 section 1.3', () => {
    expect(acceptKeyFor('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
    expect(handshakeResponse('dGhlIHNhbXBsZSBub25jZQ==')).toBe(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n',
    )
  })
})

describe('frames', () => {
  it('encodes the unmasked "Hello" of RFC 6455 section 5.7', () => {
    expect(encodeText('Hello')).toEqual(Buffer.from([0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]))
  })

  it('decodes the masked "Hello" of RFC 6455 section 5.7', () => {
    const decoded = decodeClientFrames(Buffer.from([0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58]))
    expect(decoded.violation).toBe(false)
    expect(decoded.remainder.length).toBe(0)
    expect(decoded.frames).toEqual([{ opcode: OPCODE.text, payload: Buffer.from('Hello') }])
  })

  it('uses the 16-bit and 64-bit length forms at their boundaries', () => {
    expect(encodeFrame(OPCODE.text, Buffer.alloc(125)).subarray(0, 2)).toEqual(Buffer.from([0x81, 125]))
    expect(encodeFrame(OPCODE.text, Buffer.alloc(126)).subarray(0, 4)).toEqual(Buffer.from([0x81, 126, 0, 126]))
    expect(encodeFrame(OPCODE.text, Buffer.alloc(65_535)).subarray(0, 4)).toEqual(Buffer.from([0x81, 126, 0xff, 0xff]))
    expect(encodeFrame(OPCODE.text, Buffer.alloc(65_536)).subarray(0, 10)).toEqual(
      Buffer.from([0x81, 127, 0, 0, 0, 0, 0, 1, 0, 0]),
    )
  })

  it('treats an unmasked client frame and an oversized one as protocol violations', () => {
    expect(decodeClientFrames(Buffer.from([0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]))).toMatchObject({ violation: true, frames: [] })
    const huge = maskedFrame(OPCODE.text, Buffer.alloc(64 * 1024 + 1))
    expect(decodeClientFrames(huge).violation).toBe(true)
    const hugest = Buffer.concat([Buffer.from([0x81, 0xff]), Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.alloc(4)])
    expect(decodeClientFrames(hugest).violation).toBe(true)
  })

  it('round-trips any payload through encode, mask and decode', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 70_000 }).filter((bytes) => bytes.length <= 64 * 1024),
        fc.constantFrom(OPCODE.text, OPCODE.ping, OPCODE.pong, OPCODE.close),
        fc.uint8Array({ minLength: 4, maxLength: 4 }),
        (bytes, opcode, mask) => {
          const payload = Buffer.from(bytes)
          const decoded = decodeClientFrames(maskedFrame(opcode, payload, Buffer.from(mask)))
          expect(decoded).toEqual({ frames: [{ opcode, payload }], remainder: Buffer.alloc(0), violation: false })
        },
      ),
      { numRuns: 60 },
    )
  })

  it('decodes the same frames however the bytes are split across reads', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uint8Array({ maxLength: 300 }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.integer({ min: 1, max: 97 }), { minLength: 1, maxLength: 20 }),
        (payloads, cuts) => {
          const stream = Buffer.concat(payloads.map((bytes) => maskedFrame(OPCODE.text, Buffer.from(bytes))))
          const received: Buffer[] = []
          let unread: Buffer = Buffer.alloc(0)
          let offset = 0
          for (let index = 0; offset < stream.length; index++) {
            const size = cuts[index % cuts.length]!
            const decoded = decodeClientFrames(Buffer.concat([unread, stream.subarray(offset, offset + size)]))
            expect(decoded.violation).toBe(false)
            received.push(...decoded.frames.map((frame) => frame.payload))
            unread = decoded.remainder
            offset += size
          }
          expect(unread.length).toBe(0)
          expect(received).toEqual(payloads.map((bytes) => Buffer.from(bytes)))
        },
      ),
      { numRuns: 60 },
    )
  })
})

import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodePng, encodePng } from '../../src/node/png.ts'
import { renderFrame } from '../../src/render.ts'
import { STATES } from '../../src/states.ts'

describe('png', () => {
  it('reads back exactly the pixels it writes', () => {
    const pixels = renderFrame(STATES.sending[0]!, 3)
    const decoded = decodePng(encodePng(pixels))
    expect([decoded.width, decoded.height]).toEqual([48, 51])
    expect(decoded.data).toEqual(pixels.data)
  })

  it('reads grey, RGB, grey-alpha and palette images with every row filter', () => {
    const png = (type: number, rows: number[][], extra: Buffer[] = []) => {
      const header = Buffer.alloc(13)
      header.writeUInt32BE(2, 0)
      header.writeUInt32BE(rows.length, 4)
      header[8] = 8
      header[9] = type
      const raw = Buffer.from(rows.flat())
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        ...extra,
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
      ])
    }
    const grey = decodePng(
      png(0, [
        [0, 10, 20],
        [1, 5, 5],
        [2, 1, 1],
        [3, 4, 4],
        [4, 1, 1],
      ]),
    )
    expect([...grey.data.subarray(0, 8)]).toEqual([10, 10, 10, 255, 20, 20, 20, 255])
    const rgb = decodePng(png(2, [[0, 1, 2, 3, 4, 5, 6]]))
    expect([...rgb.data.subarray(4, 8)]).toEqual([4, 5, 6, 255])
    const greyAlpha = decodePng(png(4, [[0, 9, 128, 7, 0]]))
    expect([...greyAlpha.data.subarray(0, 4)]).toEqual([9, 9, 9, 128])
    const palette = decodePng(
      png(3, [[0, 0, 1]], [chunk('PLTE', Buffer.from([1, 2, 3, 4, 5, 6])), chunk('tRNS', Buffer.from([0]))]),
    )
    expect([...palette.data]).toEqual([1, 2, 3, 0, 4, 5, 6, 255])
  })

  it('refuses bit depths and color types it does not read', () => {
    const header = Buffer.alloc(13)
    header[8] = 16
    const sixteen = Buffer.concat([Buffer.alloc(8), chunk('IHDR', header)])
    expect(() => decodePng(sixteen)).toThrow('unsupported bit depth 16')
    header[8] = 8
    header[9] = 5
    const odd = Buffer.concat([Buffer.alloc(8), chunk('IHDR', header)])
    expect(() => decodePng(odd)).toThrow('unsupported color type 5')
  })
})

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  return Buffer.concat([head, data, Buffer.alloc(4)])
}

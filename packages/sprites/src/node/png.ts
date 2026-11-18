import { deflateSync, inflateSync } from 'node:zlib'
import type { Pixels } from '../render.ts'

/** Encodes 8-bit RGBA pixels as a PNG file. */
export function encodePng(image: Pixels): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(image.width, 0)
  ihdr.writeUInt32BE(image.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // 8-bit RGBA
  const stride = image.width * 4
  const raw = Buffer.alloc((stride + 1) * image.height)
  for (let y = 0; y < image.height; y++)
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ])
}

/** Decodes 8-bit RGBA, RGB, grey or palette PNGs without interlacing (enough for tests and tooling). */
export function decodePng(buf: Buffer): Pixels {
  let pos = 8
  let width = 0
  let height = 0
  let type = 0
  let depth = 0
  let plte: Buffer | undefined
  let trns: Buffer | undefined
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const t = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (t === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]!
      type = data[9]!
    } else if (t === 'PLTE') plte = data
    else if (t === 'tRNS') trns = data
    else if (t === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`)
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type]
  if (!channels) throw new Error(`unsupported color type ${type}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8ClampedArray(width * height * 4)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0
      const b = prev[i]!
      const c = i >= channels ? prev[i - channels]! : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const pred =
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? (a + b) >> 1
              : filter === 4
                ? pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c
                : 0
      line[i] = (line[i]! + pred) & 0xff
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const s = x * channels
      if (type === 6) out.set(line.subarray(s, s + 4), o)
      else if (type === 2) {
        out.set(line.subarray(s, s + 3), o)
        out[o + 3] = 255
      } else if (type === 0) {
        out.fill(line[s]!, o, o + 3)
        out[o + 3] = 255
      } else if (type === 4) {
        out.fill(line[s]!, o, o + 3)
        out[o + 3] = line[s + 1]!
      } else {
        const k = line[s]!
        out.set(plte!.subarray(k * 3, k * 3 + 3), o)
        out[o + 3] = trns && k < trns.length ? trns[k]! : 255
      }
    }
    prev = line
  }
  return { width, height, data: out }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

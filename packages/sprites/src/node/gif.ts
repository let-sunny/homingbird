import type { Pixels } from '../render.ts'

/** Encodes a looping GIF89a: one global palette, transparent where alpha is below half. */
export function encodeGif(frames: GifFrame[]): Buffer {
  const { width, height } = frames[0]!.pixels
  const colors = new Map<number, number>()
  for (const { pixels } of frames) {
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3]! < 128) continue
      const c = (pixels.data[i]! << 16) | (pixels.data[i + 1]! << 8) | pixels.data[i + 2]!
      if (!colors.has(c)) colors.set(c, colors.size)
    }
  }
  if (colors.size > 255) throw new Error('more than 255 colors')
  const transparent = 255
  const bytes: number[] = [...Buffer.from('GIF89a')]
  const u16 = (v: number) => bytes.push(v & 0xff, (v >> 8) & 0xff)
  u16(width)
  u16(height)
  bytes.push(0xf7, 0, 0) // global color table, 256 entries
  const table = new Array(256 * 3).fill(0)
  for (const [c, i] of colors) table.splice(i * 3, 3, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff)
  bytes.push(...table)
  bytes.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0) // loop forever
  for (const { pixels, ms } of frames) {
    bytes.push(0x21, 0xf9, 0x04, (2 << 2) | 1) // restore to background, transparency on
    u16(Math.round(ms / 10))
    bytes.push(transparent, 0)
    bytes.push(0x2c)
    u16(0)
    u16(0)
    u16(width)
    u16(height)
    bytes.push(0)
    const idx = new Uint8Array(width * height)
    for (let p = 0; p < idx.length; p++) {
      const i = p * 4
      idx[p] =
        pixels.data[i + 3]! < 128
          ? transparent
          : colors.get((pixels.data[i]! << 16) | (pixels.data[i + 1]! << 8) | pixels.data[i + 2]!)!
    }
    bytes.push(8)
    const data = lzw(idx, 8)
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255)
      bytes.push(block.length, ...block)
    }
    bytes.push(0)
  }
  bytes.push(0x3b)
  return Buffer.from(bytes)
}

export interface GifFrame {
  pixels: Pixels
  ms: number
}

function lzw(indices: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize
  const end = clear + 1
  const out: number[] = []
  let bitBuf = 0
  let bitLen = 0
  let codeSize = minCodeSize + 1
  const emit = (code: number) => {
    bitBuf |= code << bitLen
    bitLen += codeSize
    while (bitLen >= 8) {
      out.push(bitBuf & 0xff)
      bitBuf >>>= 8
      bitLen -= 8
    }
  }
  let dict = new Map<string, number>()
  let next = end + 1
  const reset = () => {
    dict = new Map()
    next = end + 1
    codeSize = minCodeSize + 1
  }
  emit(clear)
  let prefix = String(indices[0])
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!
    const combo = `${prefix},${k}`
    if (dict.has(combo)) {
      prefix = combo
      continue
    }
    emit(prefix.includes(',') ? dict.get(prefix)! : Number(prefix))
    if (next < 4096) {
      dict.set(combo, next++)
      if (next > 1 << codeSize && codeSize < 12) codeSize++
    } else {
      emit(clear)
      reset()
    }
    prefix = String(k)
  }
  emit(prefix.includes(',') ? dict.get(prefix)! : Number(prefix))
  emit(end)
  if (bitLen > 0) out.push(bitBuf & 0xff)
  return out
}

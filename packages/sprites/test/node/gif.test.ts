import { describe, expect, it } from 'vitest'
import { encodeGif } from '../../src/node/gif.ts'
import { blank, renderFrame } from '../../src/render.ts'
import { STATES } from '../../src/states.ts'

describe('gif', () => {
  it('writes a looping GIF89a with one image per frame and its delay', () => {
    const frames = STATES.sending.map((frame) => ({ pixels: renderFrame(frame, 4), ms: frame.ms }))
    const gif = encodeGif(frames)
    expect(gif.subarray(0, 6).toString('ascii')).toBe('GIF89a')
    expect(gif.includes(Buffer.from('NETSCAPE2.0'))).toBe(true)
    const delays = [...gif.entries()].filter(([at, byte]) => byte === 0x21 && gif[at + 1] === 0xf9)
    expect(delays.length).toBeGreaterThanOrEqual(frames.length)
    expect(gif.at(-1)).toBe(0x3b)
  })

  it('refuses more colors than one palette holds', () => {
    const many = blank(300, 1)
    for (let x = 0; x < 300; x++) many.data.set([x % 256, Math.floor(x / 256), 7, 255], x * 4)
    expect(() => encodeGif([{ pixels: many, ms: 100 }])).toThrow('more than 255 colors')
  })

  it('restarts its code table on large noisy images', () => {
    const noisy = blank(200, 200)
    for (let at = 0; at < 200 * 200; at++) noisy.data.set([(at * 37) % 251, 0, 0, 255], at * 4)
    expect(encodeGif([{ pixels: noisy, ms: 100 }]).length).toBeGreaterThan(1000)
  })
})

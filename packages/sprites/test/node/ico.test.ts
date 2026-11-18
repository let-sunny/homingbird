import { describe, expect, it } from 'vitest'
import { markPixels } from '../../src/brand-art.ts'
import { encodeIco } from '../../src/node/ico.ts'

describe('ico', () => {
  it('lists each size in the directory and stores it as PNG', () => {
    const ico = encodeIco([16, 32, 256].map(markPixels))
    expect(ico.readUInt16LE(4)).toBe(3)
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 0])
    const firstImage = ico.readUInt32LE(6 + 12)
    expect(ico.subarray(firstImage + 1, firstImage + 4).toString('ascii')).toBe('PNG')
  })
})

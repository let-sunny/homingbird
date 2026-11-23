import { presetById } from '@homingbird/sprites'
import { describe, expect, it } from 'vitest'
import { isPipLook } from '../src/pip-look.ts'

const pigeon = presetById('pigeon')!
const cat = presetById('cat')!

describe('isPipLook', () => {
  it('is true for Pip however it is named or spelled, and false for anything else', () => {
    expect(isPipLook(pigeon)).toBe(true)
    expect(isPipLook({ ...pigeon, id: 'x-y', name: 'Other' })).toBe(true)
    expect(isPipLook({ ...pigeon, palette: { B: '#8DA4CB' } })).toBe(true)
    expect(isPipLook(cat)).toBe(false)
    expect(isPipLook({ ...pigeon, noFeet: true })).toBe(false)
    expect(isPipLook({ ...pigeon, noFeet: false })).toBe(true)
    for (const key of ['B', 'D', 'O', 'F', 'K'])
      expect(isPipLook({ ...pigeon, palette: { [key]: '#123456' } })).toBe(false)
    expect(isPipLook({ ...pigeon, marks: [[6, 3, 1, 1, '#6D86B0']] })).toBe(false)
    expect(isPipLook({ nonsense: true })).toBe(false)
    expect(isPipLook(undefined)).toBe(false)
  })
})

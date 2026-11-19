import { describe, expect, it } from 'vitest'
import { CLIENT_KIND, deviceClientKindOf } from '../src/client-kinds.ts'

describe('client kinds', () => {
  it('takes a kind a device sign-in names, and anything else as a plain device', () => {
    expect(['cli', 'mcp', 'plugin'].map((kind) => deviceClientKindOf(kind))).toEqual(['cli', 'mcp', 'plugin'])
    expect(deviceClientKindOf(undefined)).toBe('device')
    expect(deviceClientKindOf('oauth')).toBe('device')
    expect(deviceClientKindOf('Laptop of Ana')).toBe('device')
    expect(CLIENT_KIND.is('browser')).toBe(true)
  })
})

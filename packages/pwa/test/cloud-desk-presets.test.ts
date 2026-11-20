import { DESK_WAKE_HEADERS_MAX, isReservedWakeHeader } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { CLOUD_DESK_PRESETS } from '../src/cloud-desk-presets.ts'

describe('the cloud desk presets', () => {
  it('start with the Claude routine’s API trigger, then a generic POST', () => {
    expect(CLOUD_DESK_PRESETS.map((preset) => preset.id)).toEqual(['routine', 'generic'])
    expect(CLOUD_DESK_PRESETS[0].urlPlaceholder).toMatch(
      /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/.+\/fire$/,
    )
    expect(CLOUD_DESK_PRESETS[0].headers.map((header) => [header.name, header.value])).toEqual([
      ['Authorization', ''],
      ['anthropic-version', '2023-06-01'],
      ['anthropic-beta', 'experimental-cc-routine-2026-04-01'],
    ])
  })

  it('fill in only headers the server lets a person set, never a token', () => {
    for (const preset of CLOUD_DESK_PRESETS) {
      expect(preset.headers.length).toBeLessThanOrEqual(DESK_WAKE_HEADERS_MAX)
      for (const header of preset.headers) {
        expect(isReservedWakeHeader(header.name)).toBe(false)
        expect(header.value).not.toMatch(/Bearer/)
      }
    }
  })
})

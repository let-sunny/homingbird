import { describe, expect, it } from 'vitest'
import { CHANNEL_SOURCES_MAX, ChannelDrafting } from '../src/channel-drafting.ts'

describe('ChannelDrafting', () => {
  it('holds a channel, its instruction and at most five web sources', () => {
    const drafting = { channel: 'billing', instruction: '', sources: ['https://wiki.example/a'] }
    expect(ChannelDrafting.decode(drafting)._tag).toBe('Ok')
    const many = Array.from(
      { length: CHANNEL_SOURCES_MAX + 1 },
      (_, index) => `https://wiki.example/${index}`,
    )
    expect(ChannelDrafting.decode({ ...drafting, sources: many })._tag).toBe('Err')
  })
})

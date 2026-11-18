import { ConversationId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { isWithin, webClientLink } from '../src/web-client.ts'

describe('webClientLink', () => {
  it('links to the front page, or deep-links to a conversation', () => {
    expect(webClientLink('https://hb.example.com//', null)).toBe('https://hb.example.com/')
    expect(webClientLink('https://hb.example.com', ConversationId.of('conv00000000'))).toBe(
      'https://hb.example.com/#/c/conv_conv00000000',
    )
  })
})

describe('isWithin', () => {
  it('accepts only web addresses on the server’s own origin', () => {
    expect(isWithin('https://hb.example.com', 'https://hb.example.com/#/device/BCDF-GHJK')).toBe(true)
    expect(isWithin('https://hb.example.com', 'https://hb.example.com.evil.example/')).toBe(false)
    expect(isWithin('https://hb.example.com', 'http://hb.example.com/')).toBe(false)
    expect(isWithin('https://hb.example.com', 'javascript:alert(1)')).toBe(false)
    expect(isWithin('not a url', 'https://hb.example.com/')).toBe(false)
  })
})

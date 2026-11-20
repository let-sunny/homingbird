import { ConversationId, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { draftLink, isWithin, reviewLink, webClientLink } from '../src/web-client.ts'

describe('webClientLink', () => {
  it('links to the front page, or deep-links to a conversation', () => {
    expect(webClientLink('https://hb.example.com//', null)).toBe('https://hb.example.com/')
    expect(webClientLink('https://hb.example.com', ConversationId.of('conv00000000'))).toBe(
      'https://hb.example.com/#/c/conv_conv00000000',
    )
  })
})

describe('draftLink and reviewLink', () => {
  it('deep-link to one draft’s card, in its conversation or on its channel’s agent page', () => {
    const draft = { id: NoteId.of('draft0000000'), conversationId: ConversationId.of('conv00000000') }
    expect(draftLink('https://hb.example.com/', draft)).toBe(
      'https://hb.example.com/#/c/conv_conv00000000?draft=note_draft0000000',
    )
    expect(reviewLink('https://hb.example.com', 'payments-wiki')).toBe(
      'https://hb.example.com/#/channel/payments-wiki/agent',
    )
    expect(reviewLink('https://hb.example.com', 'payments-wiki', draft.id)).toBe(
      'https://hb.example.com/#/channel/payments-wiki/agent?draft=note_draft0000000',
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

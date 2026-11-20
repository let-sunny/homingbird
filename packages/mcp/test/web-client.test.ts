import { ConversationId, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { draftLink, webClientLink } from '../src/web-client.ts'

describe('webClientLink', () => {
  it('links to the front page when no conversation is named', () => {
    expect(webClientLink('https://hb.example.com', null)).toBe('https://hb.example.com/')
    expect(webClientLink('https://hb.example.com//', null)).toBe('https://hb.example.com/')
  })

  it('deep-links to a conversation', () => {
    expect(webClientLink('https://hb.example.com/', ConversationId.of('conv00000000'))).toBe(
      'https://hb.example.com/#/c/conv_conv00000000',
    )
  })

  it('deep-links to one draft’s card in its conversation', () => {
    const draft = { id: NoteId.of('draft0000000'), conversationId: ConversationId.of('conv00000000') }
    expect(draftLink('https://hb.example.com/', draft)).toBe(
      'https://hb.example.com/#/c/conv_conv00000000?draft=note_draft0000000',
    )
  })
})

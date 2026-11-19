import type { ConversationId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { changedSince, changesTo, countChange } from '../src/thread-changes.ts'

const room = (name: string) => name as ConversationId

describe('thread changes', () => {
  it('counts changes per conversation, starting from none', () => {
    expect(changesTo(room('conv_a'))).toBe(0)
    countChange(room('conv_a'))
    countChange(room('conv_a'))
    expect(changesTo(room('conv_a'))).toBe(2)
    expect(changesTo(room('conv_b'))).toBe(0)
  })

  it('tells a load whether its conversation changed while the snapshot was on its way', () => {
    const before = changesTo(room('conv_c'))
    countChange(room('conv_d'))
    expect(changedSince(room('conv_c'), before)).toBe(false)
    countChange(room('conv_c'))
    expect(changedSince(room('conv_c'), before)).toBe(true)
  })
})

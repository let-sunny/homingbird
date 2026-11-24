import type { ConversationId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { changeCounter } from '../src/thread-changes.ts'

const room = (name: string) => name as ConversationId

describe('thread changes', () => {
  it('counts changes per conversation, starting from none', () => {
    const changes = changeCounter()
    expect(changes.changesTo(room('conv_a'))).toBe(0)
    changes.count(room('conv_a'))
    changes.count(room('conv_a'))
    expect(changes.changesTo(room('conv_a'))).toBe(2)
    expect(changes.changesTo(room('conv_b'))).toBe(0)
  })

  it('forgets every conversation it counted', () => {
    const changes = changeCounter()
    changes.count(room('conv_a'))
    changes.forget()
    expect(changes.changesTo(room('conv_a'))).toBe(0)
  })

  it('tells a load whether its conversation changed while the snapshot was on its way', () => {
    const changes = changeCounter()
    const before = changes.changesTo(room('conv_c'))
    changes.count(room('conv_d'))
    expect(changes.changedSince(room('conv_c'), before)).toBe(false)
    changes.count(room('conv_c'))
    expect(changes.changedSince(room('conv_c'), before)).toBe(true)
  })
})

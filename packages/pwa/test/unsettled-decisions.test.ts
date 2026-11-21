import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { heldWordsFor } from '../src/held-decisions.ts'
import { forgetUnsettled, keepUnsettled, keptUnsettled } from '../src/unsettled-decisions.ts'
import { fakePage } from './support/context.ts'
import { ANA, BEN, ROOM } from './support/fixtures.ts'

const decision = (noteId: string, review = false) => ({
  noteId: noteId as never,
  conversationId: ROOM,
  kind: 'send' as const,
  review,
  settles: 1,
  words: heldWordsFor('Ben').send,
  run: T.unit,
  phase: 'waiting' as const,
})

describe('the decisions this browser keeps until they are carried out', () => {
  it('keeps each decision once per person, and forgets each, and the key once none is left', () => {
    const { page, local } = fakePage('#/')
    keepUnsettled(page.storage, ANA, decision('n1'))
    keepUnsettled(page.storage, ANA, decision('n2', true))
    keepUnsettled(page.storage, ANA, decision('n1'))
    expect(keptUnsettled(page.storage, ANA)).toEqual([
      { noteId: 'n2', kind: 'send', review: true, notDone: heldWordsFor('Ben').send.notDone },
      { noteId: 'n1', kind: 'send', review: false, notDone: heldWordsFor('Ben').send.notDone },
    ])
    expect(keptUnsettled(page.storage, BEN)).toEqual([])
    forgetUnsettled(page.storage, ANA, 'n1' as never)
    forgetUnsettled(page.storage, ANA, 'n2' as never)
    expect(local.size).toBe(0)
  })

  it('reads nothing from what it cannot read', () => {
    const { page, local } = fakePage('#/')
    const key = `homingbird.unsettled.${ANA}`
    for (const stored of [
      'not json',
      '{"a":1}',
      '[1,{"noteId":"n1"},{"noteId":"n1","kind":"send","review":1,"notDone":"x"}]',
    ]) {
      local.set(key, stored)
      expect(keptUnsettled(page.storage, ANA)).toEqual([])
    }
    local.set(
      key,
      '[{"noteId":"n1","kind":"discard","review":false,"notDone":"x"},{"noteId":"n2","kind":"sent","review":false,"notDone":"x"},null]',
    )
    expect(keptUnsettled(page.storage, ANA).map((one) => one.noteId)).toEqual(['n1'])
  })
})

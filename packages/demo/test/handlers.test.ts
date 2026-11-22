import { Task as T, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { DEMO_REFUSAL, found, handlersOf } from '../src/handlers.ts'
import { createWorld } from '../src/world.ts'
import { NOW } from './support/demo.ts'

describe('handlersOf', () => {
  it('answers the reads and decisions of notes, channels and the account, and leaves the rest out', () => {
    const handlers = handlersOf(createWorld(makeTestClock(NOW)))
    for (const name of ['drafts.send', 'reviews.list', 'me.get'] as const)
      expect(handlers[name]).toBeTypeOf('function')
    expect(handlers['blocks.add']).toBeUndefined()
    expect(DEMO_REFUSAL).toMatchObject({
      _tag: 'Forbidden',
      message: expect.stringMatching(/^The demo does not/),
    })
  })
})

describe('found', () => {
  it('succeeds with a value it found, and says what was missing otherwise', async () => {
    expect(await T.runPromise(found(0, 'missing'))).toBe(0)
    for (const nothing of [null, undefined])
      expect(await T.run(found(nothing, 'No such thing.'))).toMatchObject({
        _tag: 'Err',
        error: { error: { _tag: 'NotFound', message: 'No such thing.' } },
      })
  })
})

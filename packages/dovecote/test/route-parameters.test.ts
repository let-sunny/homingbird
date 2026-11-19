import { Task as T } from '@homingbird/kernel'
import { NoteId } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { channelPageSize, identifier, pageSize } from '../src/api/route-parameters.ts'

describe('route parameters', () => {
  it('decode an identifier the route names, and answer 400 for anything else', async () => {
    expect(await T.runPromise(T.result(identifier(NoteId, 'note_abcdefghijkl')))).toMatchObject({
      _tag: 'Ok',
      value: 'note_abcdefghijkl',
    })
    expect(await T.runPromise(T.result(identifier(NoteId, '../etc')))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Invalid', message: 'That identifier is not valid.' },
    })
  })

  it('read a page size between 1 and 200, 50 when none is given', () => {
    expect(pageSize(undefined)).toBe(50)
    expect(channelPageSize(undefined)).toBe(50)
    fc.assert(
      fc.property(fc.integer({ min: -1_000, max: 1_000 }), (limit) => {
        for (const size of [pageSize(String(limit)), channelPageSize(String(limit))]) {
          expect(size).toBeGreaterThanOrEqual(1)
          expect(size).toBeLessThanOrEqual(200)
        }
      }),
    )
  })
})

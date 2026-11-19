import { describe, expectTypeOf, it } from 'vitest'
import type * as AsRead from '../src/as-read.ts'
import type { Note } from '../src/model.ts'

describe('responses as a client reads them', () => {
  it('widen every tolerant enum by unknown, and keep every other field as the server sends it', () => {
    expectTypeOf<AsRead.Note['status']>().toEqualTypeOf<Note['status'] | 'unknown'>()
    expectTypeOf<AsRead.Note['body']>().toEqualTypeOf<Note['body']>()
    expectTypeOf<AsRead.Debate['status']>().toEqualTypeOf<
      'open' | 'concluding' | 'closed' | 'ended' | 'unknown'
    >()
    expectTypeOf<AsRead.Achievement>().toExtend<string>()
    expectTypeOf<'unknown'>().toExtend<AsRead.Achievement>()
    expectTypeOf<AsRead.ServerInfo['protocolVersion']>().toEqualTypeOf<number>()
  })

  it('pass on only the events a client knows', () => {
    expectTypeOf<AsRead.EventBody['type']>().toExtend<string>()
    expectTypeOf<'unknown'>().toExtend<AsRead.EventBody['type']>()
    expectTypeOf<Extract<AsRead.KnownEvent['body'], { type: 'unknown' }>>().toBeNever()
  })
})

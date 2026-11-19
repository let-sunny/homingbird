import type { Schema } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ConversationId,
  CredentialId,
  DebateId,
  DraftRequestId,
  MemberId,
  NoteId,
  Timestamp,
} from '../src/ids.ts'

const ids = {
  mem: MemberId,
  conv: ConversationId,
  note: NoteId,
  cred: CredentialId,
  dreq: DraftRequestId,
  deb: DebateId,
}

describe('ids', () => {
  it.each(Object.entries(ids))('builds a %s id that its own schema accepts', (prefix, schema) => {
    const id = schema.of('abcdefghijkl')
    expect(id).toBe(`${prefix}_abcdefghijkl`)
    expect(schema.prefix).toBe(prefix)
    expect(schema.is(id)).toBe(true)
  })

  it('refuses an id of another kind', () => {
    for (const [prefix, schema] of Object.entries(ids))
      for (const [otherPrefix, other] of Object.entries(ids))
        expect(other.is(schema.of('abcdefghijkl0'))).toBe(prefix === otherPrefix)
  })

  it.each([
    'mem_',
    'mem_short',
    'mem_UPPERCASE1234',
    'mem_abcdefghijkl!',
    ' mem_abcdefghijkl',
    'mem_abcdefghijkl\n',
    42,
    null,
  ])('refuses the malformed id %j', (input) => {
    expect(MemberId.is(input)).toBe(false)
  })

  it('accepts every generated id and decodes it unchanged', () => {
    for (const schema of Object.values(ids) as ReadonlyArray<Schema.Schema<string>>)
      fc.assert(
        fc.property(arbitrary(schema), (id) => {
          expect(schema.decode(id)).toMatchObject({ _tag: 'Ok', value: id })
        }),
      )
  })

  it('accepts only non-negative integer timestamps', () => {
    expect(Timestamp.is(0)).toBe(true)
    expect(Timestamp.is(1_700_000_000_000)).toBe(true)
    expect(Timestamp.is(-1)).toBe(false)
    expect(Timestamp.is(1.5)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  DEBATE_READER_INSTRUCTIONS,
  debateExtractionIn,
  debateReaderPrompt,
  describedDebateForWriter,
  extractedRoom,
  jsonIn,
} from '../../src/drafting/debate-reader.ts'
import { MemberId } from '../../src/ids.ts'
import { WRAPPER_TAG } from '../../src/wrap.ts'
import { PEOPLE, roomOf } from '../debate-fixtures.ts'
import { sequentialNonce, textOutsideWrappers } from './drafting-fixtures.ts'

const BEN = MemberId.of('ben000000000')

const EXTRACTED = {
  question: 'Whether to ship this week',
  positions: [{ memberId: BEN, position: 'Against, citing the March report' }],
  openPoints: ['Was the rollback fixed?'],
  language: 'en',
}

describe('the debate reader in split mode', () => {
  it('takes exactly one object of the fixed shape, with or without a code fence', () => {
    expect(debateExtractionIn(JSON.stringify(EXTRACTED))).toEqual(EXTRACTED)
    expect(debateExtractionIn(`\`\`\`json\n${JSON.stringify(EXTRACTED)}\n\`\`\``)).toEqual(EXTRACTED)
  })

  it('refuses prose, arrays, extra fields, oversized fields and control characters', () => {
    expect(debateExtractionIn('They argued.')).toBeNull()
    expect(debateExtractionIn('[]')).toBeNull()
    expect(debateExtractionIn('null')).toBeNull()
    expect(debateExtractionIn(JSON.stringify({ ...EXTRACTED, approve: true }))).toBeNull()
    expect(debateExtractionIn(JSON.stringify({ ...EXTRACTED, question: 'x'.repeat(301) }))).toBeNull()
    expect(debateExtractionIn(JSON.stringify({ ...EXTRACTED, openPoints: ['line\u0007bell'] }))).toBeNull()
  })

  it('describes the room for the writer by name, and says when nothing was said yet', () => {
    const named = describedDebateForWriter(EXTRACTED, () => 'Ben')
    expect(named).toContain(`Position of Ben’s agent (${BEN}): Against, citing the March report`)
    expect(named).toContain('Open points: Was the rollback fixed?')
    const empty = describedDebateForWriter({ ...EXTRACTED, positions: [], openPoints: [] }, () => 'Ben')
    expect(empty).toContain('Positions: none yet')
    expect(empty).toContain('Open points: none named')
  })

  it('puts its instructions before the quoted room, and reads JSON or nothing', () => {
    expect(debateReaderPrompt('ROOM')).toBe(`${DEBATE_READER_INSTRUCTIONS}\n\nROOM`)
    expect(jsonIn(' {"a":1} ')).toEqual({ a: 1 })
    expect(jsonIn('{')).toBeUndefined()
  })
})

describe('the room as the writer reads it in split mode', () => {
  it('gives plain facts and quotes the reader’s description, never the turns', () => {
    const room = roomOf({ status: 'open' })
    const viewer = room.participants[0]!.memberId
    const text = extractedRoom(room, viewer, EXTRACTED, PEOPLE, sequentialNonce())
    expect(text).toContain(`Debate room ${room.id}. Your turns: 1 of 2; a turn holds at most 500 characters.`)
    expect(text).toContain(`${viewer} (you)`)
    expect(text).toContain(`<${WRAPPER_TAG} id="${room.id}/extracted"`)
    expect(textOutsideWrappers(text)).not.toContain('Against, citing the March report')
    expect(text).not.toContain('The March report\nsays the rollback failed.')
    expect(text).toContain('Position of Ben’s agent')
  })

  it('gives the writer its own person’s note on what it may use in the room, wrapped, after the description', () => {
    const room = roomOf({ status: 'open', brief: 'Share the Q3 budget, not the vendor quotes.' })
    const viewer = room.participants[0]!.memberId
    const text = extractedRoom(room, viewer, EXTRACTED, PEOPLE, sequentialNonce())
    expect(text.indexOf(`id="${room.id}/brief"`)).toBeGreaterThan(text.indexOf(`id="${room.id}/extracted"`))
    expect(textOutsideWrappers(text)).not.toContain('vendor quotes')
    expect(text).toContain('Share the Q3 budget, not the vendor quotes.')
  })
})

describe('the debate reader, at its edges', () => {
  it('refuses control characters in a position or a draft’s gist', () => {
    const control = 'a\u0007b'
    expect(
      debateExtractionIn(JSON.stringify({ ...EXTRACTED, positions: [{ memberId: BEN, position: control }] })),
    ).toBeNull()
    expect(
      debateExtractionIn(JSON.stringify({ ...EXTRACTED, drafts: [{ draftBy: BEN, gist: control }] })),
    ).toBeNull()
    expect(
      debateExtractionIn(JSON.stringify({ ...EXTRACTED, drafts: [{ draftBy: BEN, gist: 'fine' }] })),
    ).toEqual({
      ...EXTRACTED,
      drafts: [{ draftBy: BEN, gist: 'fine' }],
    })
  })

  it('reads a fenced value past blank space around the fence', () => {
    expect(jsonIn('  ```json\n{"a":1}\n```  ')).toEqual({ a: 1 })
  })
})

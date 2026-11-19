import { MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  DEBATE_READER_INSTRUCTIONS,
  debateExtractionIn,
  debateReaderPrompt,
  describedDebateForWriter,
  jsonIn,
} from '../src/debate-reader.ts'

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

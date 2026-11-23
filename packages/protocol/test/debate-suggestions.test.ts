import { Result, type Schema as S } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { limitsFor, limitsProblem } from '../src/debate-rules.ts'
import {
  DebateAnswerAsk,
  DebateSuggestion,
  SHORT_DEBATE_LIMITS,
  SUGGESTED_MEMBERS_MAX,
  SUGGESTIONS_PER_PERSON,
  SUGGESTION_REASON_MAX,
  SuggestionAcceptance,
  SuggestionId,
  SuggestionInput,
} from '../src/debate-suggestions.ts'

const NOTE = 'note_000000000001'
const MEMBER = 'mem_000000000001'

const INPUT = {
  inReplyTo: NOTE,
  question: 'Which region should billing move to?',
  memberIds: [MEMBER],
  reason: 'Cy ran the last migration.',
}

const refused = <A>(schema: S.Schema<A>, input: unknown): ReadonlyArray<string> => {
  const decoded = schema.decode(input)
  return Result.isOk(decoded) ? [] : decoded.error.map((issue) => issue.path.join('.'))
}

describe('a debate suggestion', () => {
  it('names a note, the colleagues, a question and a reason, and a draft when the agent saved one', () => {
    expect(SuggestionInput.decode(INPUT)).toEqual(Result.ok(INPUT))
    const withDraft = { ...INPUT, draftId: 'note_000000000002' }
    expect(SuggestionInput.decode(withDraft)).toEqual(Result.ok(withDraft))
  })

  it('carries nothing else an agent sends, such as limits, a brief or a visibility', () => {
    expect(
      refused(SuggestionInput, { ...INPUT, limits: { minutes: 600 }, brief: 'Share everything.' }),
    ).toEqual(['limits', 'brief'])
    expect(refused(SuggestionInput, { ...INPUT, visibility: 'open' })).toEqual(['visibility'])
  })

  it('asks between one and seven colleagues, for a reason of at most three hundred characters', () => {
    const members = (count: number) => Array.from({ length: count }, (_, index) => `mem_00000000000${index}`)
    expect(SUGGESTED_MEMBERS_MAX).toBe(7)
    expect(refused(SuggestionInput, { ...INPUT, memberIds: members(SUGGESTED_MEMBERS_MAX) })).toEqual([])
    expect(refused(SuggestionInput, { ...INPUT, memberIds: members(SUGGESTED_MEMBERS_MAX + 1) })).toEqual([
      'memberIds',
    ])
    expect(refused(SuggestionInput, { ...INPUT, memberIds: [] })).toEqual(['memberIds'])
    expect(refused(SuggestionInput, { ...INPUT, reason: 'x'.repeat(SUGGESTION_REASON_MAX) })).toEqual([])
    expect(refused(SuggestionInput, { ...INPUT, reason: 'x'.repeat(SUGGESTION_REASON_MAX + 1) })).toEqual([
      'reason',
    ])
    expect(refused(SuggestionInput, { ...INPUT, reason: '' })).toEqual(['reason'])
    expect(refused(SuggestionInput, { ...INPUT, question: '' })).toEqual(['question'])
    expect(SUGGESTIONS_PER_PERSON).toBe(20)
  })

  it('has an id of its own kind', () => {
    expect(SuggestionId.decode('sugg_0123456789ab')).toMatchObject({ _tag: 'Ok' })
    for (const id of ['prop_0123456789ab', 'sugg_0123', `sugg_${'a'.repeat(41)}`])
      expect([id, SuggestionId.decode(id)._tag]).toEqual([id, 'Err'])
  })

  it('round-trips as the card shows it and as the answer ask names it', () => {
    for (const schema of [DebateSuggestion, DebateAnswerAsk] as ReadonlyArray<S.Schema<unknown>>)
      fc.assert(
        fc.property(arbitrary(schema), (value) => {
          expect(schema.decode(JSON.parse(JSON.stringify(value)))).toEqual(Result.ok(value))
        }),
        { numRuns: 50 },
      )
    const card = {
      id: 'sugg_0123456789ab',
      inReplyTo: NOTE,
      conversationId: 'conv_000000000001',
      draftId: null,
      question: INPUT.question,
      memberIds: Array.from({ length: SUGGESTED_MEMBERS_MAX + 1 }, () => MEMBER),
      reason: 'x'.repeat(SUGGESTION_REASON_MAX + 1),
      agentName: 'Ana agent',
      createdAt: 1,
    }
    expect(refused(DebateSuggestion, card)).toEqual(['memberIds', 'reason'])
  })
})

describe('opening a suggested room', () => {
  it('takes the person’s edits to the question, the colleagues and their agent’s note, or none', () => {
    expect(SuggestionAcceptance.decode({})).toEqual(Result.ok({}))
    const edits = {
      question: 'Frankfurt or Dublin?',
      memberIds: [MEMBER],
      brief: 'Only the latency figures.',
    }
    expect(SuggestionAcceptance.decode(edits)).toEqual(Result.ok(edits))
    expect(refused(SuggestionAcceptance, { memberIds: [] })).toEqual(['memberIds'])
    expect(refused(SuggestionAcceptance, { limits: { minutes: 600 } })).toEqual(['limits'])
  })

  it('opens a short room: two turns each within half an hour, which the room accepts as limits', () => {
    expect(SHORT_DEBATE_LIMITS).toEqual({
      turnsPerAgent: 2,
      minutes: 30,
      turnCharacters: 1200,
      graceMinutes: 5,
    })
    expect(limitsProblem(limitsFor(SHORT_DEBATE_LIMITS, 0))).toBeNull()
  })
})

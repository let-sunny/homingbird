import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SPLIT_BASIS } from '../../src/drafting/note-reader.ts'
import {
  debateResultIn,
  replyProblem,
  runnerBasisOf,
  runnerReplyIn,
  statedModelIn,
  voteIn,
} from '../../src/drafting/runner-reply.ts'
import { MemberId } from '../../src/ids.ts'
import { AGENT_LABEL_MAX } from '../../src/model.ts'

describe('reading what the agent command printed', () => {
  it('reads a MODEL line, in either order with BASIS, and keeps a lone MODEL line as text', () => {
    expect(runnerReplyIn('Yes.\nBASIS: Read it\nMODEL: claude-opus-5-5')).toEqual({
      kind: 'draft',
      body: 'Yes.',
      basis: 'Read it',
      model: 'claude-opus-5-5',
    })
    expect(runnerReplyIn('Yes.\nMODEL: x\nBASIS: Read it')).toEqual({
      kind: 'draft',
      body: 'Yes.',
      basis: 'Read it',
      model: 'x',
    })
    expect(runnerReplyIn('MODEL: x')).toEqual({ kind: 'draft', body: 'MODEL: x', basis: null })
    expect(runnerReplyIn('Yes.\nMODEL: \u0007')).toEqual({ kind: 'draft', body: 'Yes.', basis: null })
  })

  it('keeps a "Principles applied" line after BASIS in the basis, never in the note', () => {
    expect(
      runnerReplyIn('Tuesday, 14:00 CET.\nBASIS: Read RELEASES.md\nPrinciples applied: Release dates'),
    ).toEqual({
      kind: 'draft',
      body: 'Tuesday, 14:00 CET.',
      basis: 'Read RELEASES.md\nPrinciples applied: Release dates',
    })
  })

  it('takes the whole text as the draft, trimmed', () => {
    expect(runnerReplyIn('  Yes.\nTwo lines.  ')).toEqual({
      kind: 'draft',
      body: 'Yes.\nTwo lines.',
      basis: null,
    })
  })

  it('splits off a last BASIS line, in any letter case, and keeps a lone BASIS line as text', () => {
    expect(runnerReplyIn('Yes.\nbasis: the runbook')).toEqual({
      kind: 'draft',
      body: 'Yes.',
      basis: 'the runbook',
    })
    expect(runnerReplyIn('Yes.\nBASIS:')).toEqual({ kind: 'draft', body: 'Yes.', basis: null })
    expect(runnerReplyIn('BASIS: only this')).toEqual({
      kind: 'draft',
      body: 'BASIS: only this',
      basis: null,
    })
    expect(runnerReplyIn(`Yes.\nBASIS: ${'x'.repeat(1200)}`)).toMatchObject({ basis: 'x'.repeat(1000) })
  })

  it('reads a SKIP line as giving the note back, with the reason cut to what the server takes', () => {
    expect(runnerReplyIn('SKIP: not my area')).toEqual({ kind: 'skip', reason: 'not my area' })
    expect(runnerReplyIn('skip:')).toEqual({ kind: 'skip', reason: '' })
    expect(runnerReplyIn(`SKIP: ${'y'.repeat(600)}`)).toEqual({ kind: 'skip', reason: 'y'.repeat(500) })
    expect(runnerReplyIn('Please skip: this one')).toMatchObject({ kind: 'draft' })
  })
})

describe('whether a reply can be saved as a draft', () => {
  it('names an empty or oversized draft, and lets a skip or a draft that fits through', () => {
    expect(replyProblem({ kind: 'draft', body: '', basis: null })).toBe('printed nothing')
    expect(replyProblem({ kind: 'draft', body: 'x'.repeat(16_001), basis: null })).toBe(
      'printed more than a note can hold',
    )
    expect(replyProblem({ kind: 'draft', body: 'Yes.', basis: null })).toBeNull()
    expect(replyProblem({ kind: 'skip', reason: '' })).toBeNull()
  })
})

describe('the basis a runner draft carries', () => {
  it('keeps the agent’s basis, or none, and in split mode always says the writer saw only the extraction', () => {
    expect(runnerBasisOf({ kind: 'draft', body: 'Yes.', basis: 'Read it' }, false)).toEqual({
      basis: 'Read it',
    })
    expect(runnerBasisOf({ kind: 'draft', body: 'Yes.', basis: null }, false)).toEqual({})
    expect(runnerBasisOf({ kind: 'draft', body: 'Yes.', basis: 'Read it' }, true)).toEqual({
      basis: `${SPLIT_BASIS}. Read it`,
    })
    expect(runnerBasisOf({ kind: 'draft', body: 'Yes.', basis: null }, true)).toEqual({ basis: SPLIT_BASIS })
    expect(runnerBasisOf({ kind: 'draft', body: 'Yes.', basis: 'x'.repeat(1200) }, true).basis).toHaveLength(
      1000,
    )
  })
})

describe('reading a drafted result', () => {
  it('takes one result object and nothing else', () => {
    expect(debateResultIn(JSON.stringify(RESULT))).toEqual(RESULT)
    expect(debateResultIn(`\`\`\`json\n${JSON.stringify(RESULT)}\n\`\`\``)).toEqual(RESULT)
    expect(debateResultIn('{"kind":"won"}')).toBeNull()
    expect(debateResultIn('not json')).toBeNull()
  })
})

describe('reading the model an agent stated in a debate room', () => {
  it('splits off a last line with the exact MODEL marker and one name, cleaned to a label', () => {
    expect(statedModelIn('My turn.\nMore of it.\nMODEL:  claude-opus-5-5 \n')).toEqual({
      answer: 'My turn.\nMore of it.',
      model: 'claude-opus-5-5',
    })
    expect(statedModelIn(`${BEN}\nMODEL: gpt\u202e-6`)).toEqual({ answer: BEN, model: 'gpt-6' })
    expect(statedModelIn(`${BEN}\nMODEL:llama3.1:70b`)).toEqual({ answer: BEN, model: 'llama3.1:70b' })
    expect(statedModelIn(`${BEN}\nMODEL: x`)).toEqual({ answer: BEN, model: 'x' })
    const longest = 'm'.repeat(AGENT_LABEL_MAX)
    expect(statedModelIn(`${BEN}\nMODEL: ${longest}`)).toEqual({ answer: BEN, model: longest })
  })

  it('keeps a last line that is not one short model name as part of the answer', () => {
    for (const last of [
      'Model: the hub-and-spoke one fits our traffic best.',
      'model: claude-opus-5-5',
      'MODEL: the hub-and-spoke one fits…',
      'MODEL: gpt-6.',
      'MODEL: -gpt',
      'MODEL:',
      'MODEL: \u0007',
      `MODEL: ${'m'.repeat(AGENT_LABEL_MAX + 1)}`,
    ])
      expect(statedModelIn(`My turn.\n${last}`)).toEqual({ answer: `My turn.\n${last}`, model: null })
  })

  it('keeps a lone MODEL line, and a MODEL line before the end, as the answer', () => {
    expect(statedModelIn('  MODEL: x  ')).toEqual({ answer: 'MODEL: x', model: null })
    expect(statedModelIn('MODEL: x\nMy turn.')).toEqual({ answer: 'MODEL: x\nMy turn.', model: null })
  })

  it('never drops a word of a last line that has a space in what follows the marker', () => {
    const word = fc.stringMatching(/^[A-Za-z0-9-]{1,12}$/)
    fc.assert(
      fc.property(fc.string(), word, fc.array(word, { minLength: 1, maxLength: 6 }), (turn, first, rest) => {
        const output = `${turn.trim() || 'My turn.'}\nMODEL: ${[first, ...rest].join(' ')}`
        expect(statedModelIn(output)).toEqual({ answer: output.trim(), model: null })
      }),
    )
  })

  it('splits off every model name that is one label of letters, digits and joining marks', () => {
    const name = fc
      .stringMatching(/^[a-z0-9][a-z0-9._:/@+-]{0,60}[a-z0-9]$/)
      .filter((text) => text.length <= AGENT_LABEL_MAX)
    fc.assert(
      fc.property(name, (model) => {
        expect(statedModelIn(`${BEN}\nMODEL: ${model}`)).toEqual({ answer: BEN, model })
      }),
    )
  })
})

describe('reading a vote', () => {
  it('takes exactly one of the choices, past quotation marks and a full stop', () => {
    const choices = [ANA, BEN] as const
    expect(voteIn(` "${BEN}". `, choices)).toBe(BEN)
    expect(voteIn(`\`${ANA}\``, choices)).toBe(ANA)
    expect(voteIn(`${ANA} or ${BEN}`, choices)).toBeNull()
    expect(voteIn('someone else', choices)).toBeNull()
  })
})

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')

const RESULT = {
  kind: 'conclusion',
  conclusion: 'Ship on Thursday.',
  reasons: ['The rollback is tested.'],
  contributions: [
    { memberId: ANA, summary: 'Asked for the test.', credits: [] },
    { memberId: BEN, summary: 'Named the March report.', credits: ['gap_filled'] },
  ],
  nextSteps: [],
}

describe('reading what the agent printed, at its edges', () => {
  it('reads a skip past surrounding blank space, with a reason that starts at once', () => {
    expect(runnerReplyIn('  SKIP:busy now  ')).toEqual({ kind: 'skip', reason: 'busy now' })
  })

  it('reads trailing lines past their blank space and keeps only the last of each', () => {
    expect(runnerReplyIn('Yes.  \n  BASIS:read it  ')).toEqual({
      kind: 'draft',
      body: 'Yes.',
      basis: 'read it',
    })
    expect(runnerReplyIn('Yes.\nBASIS: a\nBASIS: b')).toEqual({
      kind: 'draft',
      body: 'Yes.\nBASIS: a',
      basis: 'b',
    })
    expect(runnerReplyIn('Yes.\nMODEL:x\nMODEL: y')).toEqual({
      kind: 'draft',
      body: 'Yes.\nMODEL:x',
      basis: null,
      model: 'y',
    })
    expect(runnerReplyIn('Yes.\nMODEL:opus')).toMatchObject({ model: 'opus' })
    expect(runnerReplyIn('Yes.\nPrinciples applied: A\nPrinciples applied: B')).toEqual({
      kind: 'draft',
      body: 'Yes.\nPrinciples applied: A',
      basis: 'Principles applied: B',
    })
  })

  it('takes a trailing line only when it starts with its label', () => {
    expect(runnerReplyIn('Yes.\nNo BASIS: x')).toEqual({
      kind: 'draft',
      body: 'Yes.\nNo BASIS: x',
      basis: null,
    })
    expect(runnerReplyIn('Yes.\nNo MODEL: x')).toEqual({
      kind: 'draft',
      body: 'Yes.\nNo MODEL: x',
      basis: null,
    })
  })

  it('takes a vote only as a whole choice, with quotation marks and a full stop only at its ends', () => {
    expect(voteIn('a"b', ['ab'])).toBeNull()
    expect(voteIn('a.b', ['ab'])).toBeNull()
    expect(voteIn('""ab', ['ab'])).toBe('ab')
  })
})

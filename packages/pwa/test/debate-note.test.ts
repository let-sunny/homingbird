import { arbitrary } from '@homingbird/kernel/testing'
import {
  type Debate,
  DraftedResult,
  type MemberId,
  debateResultText,
  resultOfDraft,
} from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { debateNoteParts } from '../src/debate-note.ts'
import { debate } from './support/fixtures.ts'

const nameOf = (_: MemberId) => 'Ana'

describe('debateNoteParts', () => {
  it('reads back whether the agents agreed, the conclusion or summary, and every next step of any result the server writes', () => {
    fc.assert(
      fc.property(arbitrary(DraftedResult), (drafted) => {
        const { result } = resultOfDraft(drafted)
        const summary = result.kind === 'conclusion' ? result.conclusion : result.summary
        fc.pre(summary.trim() !== '')
        const parts = debateNoteParts(debateResultText(debate() as Debate, result, nameOf))
        expect(parts).toEqual({
          agreed: result.kind === 'conclusion',
          summary: summary.replace(/\r\n?/g, '\n').trim(),
          nextSteps: expect.any(Array),
        })
        expect(parts!.nextSteps).toHaveLength(result.nextSteps.length)
      }),
      { numRuns: 60 },
    )
  })

  it('finds the real headings even when the conclusion repeats them', () => {
    const body = [
      'From the debate room: Ship?',
      'Result: conclusion',
      'Ship.\n\nReasons\n\nNext steps\n\nContributions',
      'Reasons\n\n- Tests pass.',
      'Next steps\n\nNone proposed.',
      'Contributions\n\n- Ana’s agent: Checked.',
    ].join('\n\n')
    expect(debateNoteParts(body)).toEqual({
      agreed: true,
      summary: 'Ship.\n\nReasons\n\nNext steps\n\nContributions',
      nextSteps: [],
    })
  })

  it('gives nothing for a note in any other shape', () => {
    expect(debateNoteParts('Ship on Friday.')).toBeNull()
    expect(debateNoteParts('Result: conclusion\n\nShip.')).toBeNull()
    expect(debateNoteParts('Result: conclusion\n\nShip.\n\nNext steps\n\n- Tag\n\nContributions')).toBeNull()
    expect(
      debateNoteParts(
        'Result: conclusion\n\n\n\nReasons\n\n- R\n\nNext steps\n\n- Tag\n\nContributions\n\n- C',
      ),
    ).toBeNull()
    expect(debateNoteParts('Contributions\n\nResult: conclusion')).toBeNull()
  })
})

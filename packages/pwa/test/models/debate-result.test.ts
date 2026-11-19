import { describe, expect, it } from 'vitest'
import { resultBody, resultModel } from '../../src/models/debate-result.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, debate } from '../support/fixtures.ts'

const nameOf = (id: string) => (id === ANA ? 'Ana' : 'Ben')

describe('resultModel', () => {
  it('waits while the agents settle the result, and shows who drafted it once settled', () => {
    expect(resultModel(debate({ status: 'concluding' }), nameOf)).toEqual({
      kind: 'waiting',
      text: strings.debates.waitingForResult,
      collecting: null,
      voting: null,
    })
    const settled = resultModel(
      debate({
        status: 'closed',
        result: { result: { kind: 'unknown' } as never, draftedBy: BEN, draftedAt: 1 },
      }),
      nameOf,
    )
    expect(settled).toEqual({
      kind: 'settled',
      draftedBy: strings.debates.draftedBy({ person: 'Ben' }),
      body: { kind: 'unknown', text: strings.debates.unknownResult },
      voteRecord: null,
    })
  })
})

describe('resultBody', () => {
  it('words a conclusion with its reasons, steps and contributions', () => {
    const body = resultBody(
      {
        kind: 'conclusion',
        conclusion: 'Ship.',
        reasons: ['Ready.'],
        nextSteps: [{ step: 'Tag', owner: ANA, proposedBy: BEN }],
        contributions: [{ memberId: ANA, summary: 'Tested.', credits: ['gap_filled'] }],
      } as never,
      nameOf,
    )
    expect(body).toMatchObject({
      kind: 'known',
      heading: strings.debates.conclusion,
      reasons: ['Ready.'],
      nextSteps: { steps: [{ step: 'Tag', owner: strings.debates.owner({ person: 'Ana' }) }] },
      contributions: { rows: [{ name: 'Ana', credits: [strings.debates.credit.gap_filled] }] },
    })
  })
})

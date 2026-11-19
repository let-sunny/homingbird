import { textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { renderResultBody, resultSection, section } from '../../src/views/debate-result.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('the result of a room', () => {
  it('shows a waiting result with its deadlines, and a settled one with its vote record', () => {
    const waiting = resultSection({
      kind: 'waiting',
      text: 'Waiting',
      collecting: 'Until noon',
      voting: 'Voting',
    })
    expect(textOf(waiting)).toContain('Until noon')
    const settled = resultSection({
      kind: 'settled',
      draftedBy: 'Drafted by Ben',
      body: { kind: 'unknown', text: strings.debates.unknownResult },
      voteRecord: {
        title: 'Votes',
        none: null,
        lines: [{ kind: 'voted', memberId: 'm' as never, text: 'Ana voted' }],
      },
    })
    expect(textOf(settled)).toContain('Ana voted')
    const none = resultSection({
      kind: 'settled',
      draftedBy: 'Drafted by Ben',
      body: { kind: 'unknown', text: '?' },
      voteRecord: { title: 'Votes', none: strings.debates.noVote, lines: [] },
    })
    expect(textOf(none)).toContain(strings.debates.noVote)
  })

  it('shows points of disagreement and owned steps, and heads a section', () => {
    const host = section('Result', 'debate-result')
    host.append(
      ...(renderResultBody({
        kind: 'known',
        heading: 'No conclusion',
        summary: 'Split.',
        listHeading: 'Where',
        reasons: null,
        points: [{ category: 'goals', point: 'Risk', categoryText: 'Goals', explanation: 'Why' }],
        nextSteps: {
          heading: 'Next',
          none: null,
          steps: [{ step: 'Tag', owner: 'For Ben', proposedBy: 'By Ana' }],
        },
        contributions: { heading: 'Who', rows: [] },
      }) as Node[]),
    )
    expect(textOf(host)).toContain('RiskGoalsWhy')
    expect(textOf(host)).toContain('For Ben')
  })
})

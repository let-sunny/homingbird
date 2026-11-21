import { textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import type { ResultBody } from '../../src/models/debate-result.ts'
import { strings } from '../../src/strings.ts'
import { renderResultBody, renderVoteRecord, resultSection, section } from '../../src/views/debate-result.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('the result of a room', () => {
  it('shows a waiting result with its deadlines, and a settled one with who drafted it', () => {
    const waiting = resultSection({
      kind: 'waiting',
      text: 'Waiting',
      collecting: 'Until noon',
      voting: 'Voting',
    })
    expect(textOf(waiting)).toContain('Until noon')
    expect(waiting.querySelectorAll('p')).toHaveLength(3)
    const closed = resultSection({ kind: 'waiting', text: null, collecting: null, voting: null })
    expect(closed.querySelectorAll('p')).toHaveLength(0)
    const settled = resultSection({
      kind: 'settled',
      draftedBy: 'Drafted by Ben',
      body: { kind: 'unknown', text: strings.debates.unknownResult },
      voteRecord: null,
    })
    expect(textOf(settled)).toContain('Drafted by Ben')
    expect(textOf(settled)).toContain(strings.debates.unknownResult)
  })

  it('shows how each agent voted with its model, or that no vote was held', () => {
    const record = renderVoteRecord({
      none: null,
      lines: [
        { kind: 'voted', memberId: 'm' as never, text: 'Ana voted', model: 'Model: gpt-6' },
        { kind: 'silent', memberId: 'n' as never, text: 'Ben did not vote', model: null },
      ],
    })
    expect(textOf(record)).toContain('Ana voted')
    expect([...record.querySelectorAll('.debate-vote-model')].map((one) => one.textContent)).toEqual([
      'Model: gpt-6',
    ])
    expect(textOf(renderVoteRecord({ none: strings.debates.noVote, lines: [] }))).toContain(
      strings.debates.noVote,
    )
  })

  it('shows points of disagreement and owned steps, and heads a section', () => {
    const host = section('Result', 'debate-result')
    const body: ResultBody = {
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
      contributions: {
        heading: 'Who',
        rows: [{ name: 'Ben', summary: 'Checked.', credits: [{ text: 'Gap', hint: 'Filled' }] }],
      },
    }
    host.append(...(renderResultBody(body, { contributions: true }) as Node[]))
    expect(textOf(host)).toContain('RiskGoalsWhy')
    expect(textOf(host)).toContain('For Ben')
    expect(textOf(host)).toContain('Who')
    expect(host.querySelector('.debate-credit')!.getAttribute('title')).toBe('Filled')
    const settled = section('Result', 'debate-result', ...renderResultBody(body, { contributions: false }))
    expect(textOf(settled)).not.toContain('Who')
    expect(settled.querySelector('.debate-contributions')).toBeNull()
  })
})

import { Forbidden } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  acceptProposal,
  acceptProposals,
  discardProposal,
  refreshInterview,
  saveTeachingDocument,
} from '../../src/tasks/teaching-interview.ts'
import { fail, testApp } from '../support/app.ts'
import { taught } from '../support/fixtures.ts'

const INTERVIEW = { document: 'Refunds: 30 days.', proposals: [], limit: 20 }

describe('teaching chat tasks', () => {
  it('loads the document and the proposals, and says when they could not load', async () => {
    const { run, state } = testApp({ 'principleProposals.list': () => INTERVIEW })
    await run(refreshInterview)
    expect(state.interview.get()).toEqual(INTERVIEW)
    const failing = testApp({ 'principleProposals.list': () => ({ refusal: Forbidden({ message: 'no' }) }) })
    await failing.run(refreshInterview)
    expect(failing.state.interview.get()).toBe('failed')
  })

  it('keeps what it shows while the server is only away, and draws nothing for the same data', async () => {
    const { run, state, ...test } = testApp({
      'principleProposals.list': () =>
        isAway ? fail({ _tag: 'Unavailable', message: 'down' }) : { ...INTERVIEW },
    })
    let isAway = false
    await run(refreshInterview)
    let draws = 0
    state.interview.subscribe(() => {
      draws++
    })
    await run(refreshInterview)
    isAway = true
    await run(refreshInterview)
    expect(draws).toBe(0)
    expect(state.interview.get()).toEqual(INTERVIEW)
    expect(test.routes()).toHaveLength(3)
  })

  it('saves the document, saves or discards proposals, and shows what changed', async () => {
    const { run, sent, state } = testApp({
      'principleProposals.list': () => INTERVIEW,
      'principleProposals.acceptAll': () => taught({ limit: 9 }),
      'principles.list': () => taught(),
    })
    await run(saveTeachingDocument('Refunds: 30 days.'))
    await run(acceptProposal('prop_aaaaaaaaaaaa' as never, { rule: 'ask billing' }))
    await run(acceptProposal('prop_bbbbbbbbbbbb' as never, {}))
    await run(discardProposal('prop_cccccccccccc' as never))
    await run(acceptProposals(['prop_dddddddddddd' as never]))
    expect(state.taught.get()).toEqual(taught({ limit: 9 }))
    expect(sent.map((one) => [one.route, one.request])).toEqual([
      ['teaching.document.set', { body: { document: 'Refunds: 30 days.' } }],
      ['principleProposals.list', {}],
      ['principleProposals.accept', { params: { id: 'prop_aaaaaaaaaaaa' }, body: { rule: 'ask billing' } }],
      ['principleProposals.list', {}],
      ['principles.list', {}],
      ['principleProposals.accept', { params: { id: 'prop_bbbbbbbbbbbb' }, body: {} }],
      ['principleProposals.list', {}],
      ['principles.list', {}],
      ['principleProposals.discard', { params: { id: 'prop_cccccccccccc' } }],
      ['principleProposals.list', {}],
      ['principleProposals.acceptAll', { body: { ids: ['prop_dddddddddddd'] } }],
      ['principleProposals.list', {}],
    ])
  })
})

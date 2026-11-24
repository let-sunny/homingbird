import { Forbidden } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { open } from '../../src/tasks/resources.ts'
import {
  acceptProposal,
  acceptProposals,
  discardProposal,
  refreshInterview,
  saveTeachingDocument,
} from '../../src/tasks/teaching-interview.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { principle, taught } from '../support/fixtures.ts'

const INTERVIEW = { document: 'Refunds: 30 days.', proposals: [], limit: 20 }

describe('teaching chat tasks', () => {
  it('loads the document and the proposals', async () => {
    const { run, state } = testApp({ 'principleProposals.list': () => INTERVIEW })
    await run(refreshInterview)
    expect(state.interview.get()).toEqual(INTERVIEW)
    expect(state.interview.load.get()).toMatchObject({ loaded: true, step: 'idle' })
  })

  it('empties what it shows when the server refuses it, since the person may no longer read it', async () => {
    let isRefused = false
    const { run, state } = testApp({
      'principleProposals.list': () => (isRefused ? fail(Forbidden({ message: 'no' })) : INTERVIEW),
    })
    await run(refreshInterview)
    isRefused = true
    await run(refreshInterview)
    expect(state.interview.get()).toBeNull()
    expect(state.interview.load.get()).toMatchObject({ loaded: false, step: 'failed' })
  })

  it('saves the document, saves or discards proposals, and shows what changed', async () => {
    const { run, sent, state } = testApp({
      'principleProposals.list': () => INTERVIEW,
      'principleProposals.acceptAll': () => taught({ limit: 8 }),
      'principles.list': () => taught({ limit: 9 }),
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
      ['principles.list', {}],
    ])
  })

  it('shows the newest principles when an older answer of theirs was on its way as proposals were saved', async () => {
    const older = hold<unknown>()
    let asked = 0
    const { app, run, state } = testApp({
      'principles.list': () =>
        asked++ === 0 ? older.waiting : taught({ principles: [principle('Saved'), principle('Newer')] }),
      'principleProposals.list': () => INTERVIEW,
      'principleProposals.acceptAll': () => taught({ principles: [principle('Saved')] }),
    })
    app.launch(open('taught'))
    await settle()
    const saving = run(acceptProposals(['prop_dddddddddddd' as never]))
    await settle()
    older.release(taught())
    await saving
    await settle()
    expect(state.taught.get()!.principles.map((one) => one.topic)).toEqual(['Saved', 'Newer'])
  })
})

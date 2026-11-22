import { describe, expect, it } from 'vitest'
import {
  changePrinciple,
  deletePrinciple,
  dismissOffer,
  markPrincipleWrong,
  refreshAgentReport,
  refreshPrinciples,
  reorderPrinciples,
  savePrinciple,
  setAutoSend,
} from '../../src/tasks/teaching.ts'
import { testApp } from '../support/app.ts'
import { report, taught } from '../support/fixtures.ts'

describe('teaching tasks', () => {
  it('refreshes the agent’s figures and the principles', async () => {
    const { run, state } = testApp({ 'insights.mine': () => report(), 'principles.list': () => taught() })
    await run(refreshAgentReport)
    await run(refreshPrinciples)
    expect(state.agentReport.get()).toEqual(report())
    expect(state.taught.get()).toEqual(taught())
  })

  it('saves, changes, reorders, deletes and marks principles, then shows them again', async () => {
    const { run, sent, state } = testApp({
      'principles.list': () => taught(),
      'principles.reorder': () => taught({ limit: 9 }),
    })
    await run(savePrinciple({ topic: 'Tone', rule: 'Short.', source: null, place: null }))
    await run(savePrinciple({ kind: 'answer', topic: 'Hours', rule: '9', source: null, place: null }))
    await run(changePrinciple('p1', { enabled: false }))
    await run(reorderPrinciples(['p2', 'p1']))
    expect(state.taught.get()).toEqual(taught({ limit: 9 }))
    await run(deletePrinciple('p1'))
    await run(markPrincipleWrong('p1', 'n1' as never))
    await run(dismissOffer('o1', false))
    await run(dismissOffer('o1', true))
    expect(sent.map((one) => one.route).filter((route) => route !== 'principles.list')).toEqual([
      'principles.create',
      'principles.create',
      'principles.update',
      'principles.reorder',
      'principles.delete',
      'principles.miss',
      'principles.offers.dismiss',
      'principles.offers.dismiss',
    ])
    expect(sent.filter((one) => one.route === 'principles.offers.dismiss').map((one) => one.request)).toEqual(
      [
        { params: { id: 'o1' }, body: {} },
        { params: { id: 'o1' }, body: { stopAskingHere: true } },
      ],
    )
  })
})

describe('switching a saved answer to send itself', () => {
  it('sends the switch and places the person chose, then shows the principles again', async () => {
    const { run, sent } = testApp({ 'principles.list': () => taught() })
    await run(setAutoSend('p1', { enabled: true, places: ['conv_room00000000' as never] }))
    expect(sent.map((one) => [one.route, one.request])).toEqual([
      [
        'principles.autoSend.set',
        { params: { id: 'p1' }, body: { enabled: true, places: ['conv_room00000000'] } },
      ],
      ['principles.list', {}],
    ])
  })
})

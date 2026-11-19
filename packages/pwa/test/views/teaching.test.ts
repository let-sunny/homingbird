import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { appliedMarkers, chancesIn, taughtSection } from '../../src/views/teaching.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ROOM, channel, draft, principle, serverInfo, taught } from '../support/fixtures.ts'

usingFakeDom()

const offer = {
  id: 'offer_aaaaaaaaaaaa',
  kind: 'edit',
  noteId: 'note_aaaaaaaaaaaa',
  conversationId: ROOM,
  place: null,
  suggestion: null,
  createdAt: 1,
} as never

describe('taughtSection', () => {
  it('loads the principles, and says when they could not load', () => {
    const { context, called } = testContext()
    const shown = taughtSection(context, lifetime())
    expect(called('refreshPrinciples')).toHaveLength(1)
    expect(textOf(shown)).toBe(strings.loading)
    context.state.taught.set('failed')
    expect(getByRole(shown, 'alert').textContent).toBe(strings.trust.loadFailed)
  })

  it('invites a first principle, and adds one from the list with the place chosen', () => {
    const { context, called } = testContext()
    context.state.channels.set([channel('billing', { joined: true })])
    const shown = mount(taughtSection(context, lifetime()))
    context.state.taught.set(taught({ achievements: ['first_principle'] }))
    expect(textOf(shown)).toContain(strings.teach.empty)
    expect(textOf(shown)).toContain(strings.teach.achievements.first_principle)
    const add = getByRole(shown, 'group', { name: strings.teach.addLabel })
    fire.type(getByRole(add, 'textbox', { name: strings.teach.topic }), 'Dates')
    fire.type(getByRole(add, 'textbox', { name: strings.teach.rule }), 'Check RELEASES.md first.')
    fire.select(getByRole(shown, 'combobox', { name: strings.teach.place }), 'billing')
    getByRole(add, 'button', { name: strings.teach.addLabel }).click()
    const [save] = called('savePrinciple')
    expect(save!.args).toEqual([
      { topic: 'Dates', rule: 'Check RELEASES.md first.', source: null, place: 'billing' },
    ])
    save!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.saved })
  })

  it('switches, edits, moves, deletes and makes public or private each principle', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    const shown = mount(taughtSection(context, lifetime()))
    const tone = principle('Tone', { publicText: 'Friendly.' })
    const dates = principle('Dates')
    context.state.taught.set(taught({ principles: [tone, dates], offers: [offer] }))
    getByRole(shown, 'switch', { name: strings.todo.use({ name: 'Tone' }) }).click()
    fire.change(shown.querySelector(`[data-key="${tone.id}"] .todo-field.is-topic`)!, 'Voice')
    getByRole(shown, 'button', { name: strings.todo.moveDown({ name: 'Tone' }) }).click()
    getByRole(shown, 'button', { name: strings.teach.makePrivate({ name: 'Tone' }) }).click()
    called('changePrinciple').at(-1)!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.madePrivate })
    getByRole(shown, 'button', { name: strings.todo.more({ name: 'Dates' }) }).click()
    getByRole(shown, 'button', { name: strings.todo.delete }).click()
    expect(called('changePrinciple').map((call) => call.args)).toEqual([
      [tone.id, { enabled: false }],
      [tone.id, { topic: 'Voice' }],
      [tone.id, { publicText: null }],
    ])
    expect(called('reorderPrinciples')[0]!.args).toEqual([[dates.id, tone.id]])
    expect(called('deletePrinciple')[0]!.args).toEqual([dates.id])
    getByRole(shown, 'button', { name: strings.teach.makePublic({ name: 'Dates' }) }).click()
    expect(
      getByRole(document.getElementById('dialog')!, 'heading', { name: strings.teach.dialogTitle }),
    ).toBeTruthy()
    getByRole(shown, 'button', { name: strings.teach.notNow }).click()
    getByRole(shown, 'button', { name: strings.teach.stopAsking }).click()
    expect(called('dismissOffer').map((call) => call.args)).toEqual([
      ['offer_aaaaaaaaaaaa', false],
      ['offer_aaaaaaaaaaaa', true],
    ])
  })
})

describe('chancesIn', () => {
  it('shows this conversation’s chances to teach, while teaching is on', () => {
    const { context } = testContext()
    const shown = chancesIn(context, lifetime(), ROOM)
    context.state.taught.set(taught({ offers: [offer] }))
    expect(textOf(shown)).toContain(strings.teach.chanceEdit({ place: strings.trust.directMessages }))
    context.state.serverInfo.set(serverInfo())
    context.state.taught.set(taught({ offers: [offer] }))
    expect(shown.childNodes).toHaveLength(0)
  })
})

describe('appliedMarkers', () => {
  it('names what the agent applied and records when the person says it was wrong here', () => {
    const { context, called } = testContext()
    const tone = principle('Tone')
    context.state.taught.set(taught({ principles: [tone] }))
    const shown = appliedMarkers(context, draft('d1', { basis: 'Principles applied: Gone; Tone' }))!
    expect(textOf(shown)).toContain(strings.teach.applied({ title: 'Gone' }))
    getByRole(shown, 'button', { name: strings.teach.wrongHere }).click()
    expect(called('markPrincipleWrong')[0]!.args).toEqual([tone.id, 'd1'])
    called('markPrincipleWrong')[0]!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.wrongRecorded })
    expect(appliedMarkers(context, draft('d2'))).toBeNull()
    expect(queryByRole(shown, 'alert')).toBeNull()
  })
})

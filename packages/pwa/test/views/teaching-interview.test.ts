import type { AsRead } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { interviewSection } from '../../src/views/teaching-interview.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const proposal = (overrides: Partial<AsRead.PrincipleProposal> = {}): AsRead.PrincipleProposal => ({
  id: 'prop_aaaaaaaaaaaa' as AsRead.PrincipleProposal['id'],
  kind: 'rule',
  topic: 'Refund requests',
  rule: 'check the order date and offer a refund within 30 days',
  source: null,
  place: null,
  question: 'How do you usually handle refund requests?',
  origin: 'chat',
  rewriteOf: null,
  createdAt: 1,
  ...overrides,
})

const shownWith = (proposals: ReadonlyArray<AsRead.PrincipleProposal>, document: string | null = null) => {
  const { context, called } = testContext()
  const shown = mount(interviewSection(context, lifetime())!)
  context.state.interview.set({ document, proposals, limit: 20 })
  return { context, called, shown }
}

describe('interviewSection', () => {
  it('is left out while teaching is switched off', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(serverInfo({ teaching: false }))
    expect(interviewSection(context, lifetime())).toBeNull()
    expect(called('refreshInterview')).toEqual([])
  })

  it('loads the proposals, and says when they could not load', () => {
    const { context, called } = testContext()
    const shown = mount(interviewSection(context, lifetime())!)
    expect(called('refreshInterview')).toHaveLength(1)
    expect(textOf(shown)).toBe(strings.loading)
    context.state.interview.set('failed')
    expect(getByRole(shown, 'alert').textContent).toBe(strings.teach.chat.failed)
  })

  it('says how to start, and saves or removes a pasted document', () => {
    const { context, called, shown } = shownWith([], 'Old notes')
    expect(textOf(shown)).toContain(strings.teach.chat.empty)
    expect(textOf(shown)).toContain('/homingbird teach')
    const document = getByRole(shown, 'textbox', { name: /Principles document/ })
    fire.type(document, 'Refunds: 30 days.')
    getByRole(shown, 'button', { name: strings.teach.chat.documentSave }).click()
    getByRole(shown, 'button', { name: strings.teach.chat.documentRemove }).click()
    const [saved, removed] = called('saveTeachingDocument')
    expect(saved!.args).toEqual(['Refunds: 30 days.'])
    expect(removed!.args).toEqual([null])
    saved!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.chat.documentSaved })
    removed!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.chat.documentRemoved })
  })

  it('sends an emptied document as none', () => {
    const { called, shown } = shownWith([])
    fire.type(getByRole(shown, 'textbox', { name: /Principles document/ }), '   ')
    getByRole(shown, 'button', { name: strings.teach.chat.documentSave }).click()
    expect(called('saveTeachingDocument')[0]!.args).toEqual([null])
    expect(queryByRole(shown, 'button', { name: strings.teach.chat.documentRemove })).toBeNull()
  })

  it('saves, discards or saves all of the proposals, only on the person’s click', () => {
    const second = proposal({ id: 'prop_bbbbbbbbbbbb' as never, topic: 'Holidays', origin: 'edit' })
    const { context, called, shown } = shownWith([proposal(), second])
    expect(called('acceptProposal')).toEqual([])
    expect(textOf(shown)).toContain(strings.teach.chat.rewritesTitle)
    const card = shown.querySelector<HTMLElement>('[data-proposal="prop_aaaaaaaaaaaa"]')!
    getByRole(card, 'button', { name: strings.teach.chat.save }).click()
    getByRole(card, 'button', { name: strings.teach.chat.discard }).click()
    expect(called('acceptProposal')[0]!.args).toEqual(['prop_aaaaaaaaaaaa', {}])
    called('acceptProposal')[0]!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.chat.saved })
    expect(called('discardProposal')[0]!.args).toEqual(['prop_aaaaaaaaaaaa'])
    called('discardProposal')[0]!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.chat.discarded })
    const rewrites = shown.querySelector<HTMLElement>('[data-group="rewrites"]')!
    getByRole(rewrites, 'button', { name: strings.teach.chat.saveAll({ count: 1 }) }).click()
    expect(called('acceptProposals')[0]!.args).toEqual([['prop_bbbbbbbbbbbb']])
    called('acceptProposals')[0]!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({
      kind: 'info',
      text: strings.teach.chat.savedAll({ count: 1 }),
    })
  })

  it('saves a card with the person’s changes, or says why it cannot yet', () => {
    const { called, shown } = shownWith([proposal()])
    const card = shown.querySelector<HTMLElement>('[data-proposal="prop_aaaaaaaaaaaa"]')!
    card.querySelector('details')!.setAttribute('open', '')
    const rule = getByRole(card, 'textbox', { name: strings.teach.rule })
    fire.type(rule, ' ')
    getByRole(card, 'button', { name: strings.teach.chat.saveEdited }).click()
    expect(called('acceptProposal')).toEqual([])
    expect(getByRole(card, 'alert').textContent).toBe(strings.teach.problems.rule_empty)
    fire.type(rule, 'ask billing first')
    getByRole(card, 'button', { name: strings.teach.chat.saveEdited }).click()
    expect(called('acceptProposal')[0]!.args).toEqual([
      'prop_aaaaaaaaaaaa',
      { topic: 'Refund requests', rule: 'ask billing first' },
    ])
  })
})

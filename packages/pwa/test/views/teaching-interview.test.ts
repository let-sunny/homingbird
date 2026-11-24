import type { AsRead } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import type { ViewContext } from '../../src/views/context.ts'
import { pageData } from '../../src/views/page-data.ts'
import { interviewSection } from '../../src/views/teaching-interview.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { serverInfo } from '../support/fixtures.ts'
import { setLoad } from '../support/resource-load.ts'

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

const sectionOf = (context: ViewContext) =>
  interviewSection(context, lifetime(), pageData(context.state, context.state.interview).wait)

const shownWith = (proposals: ReadonlyArray<AsRead.PrincipleProposal>, document: string | null = null) => {
  const { context, called } = testContext()
  const shown = mount(sectionOf(context)!)
  context.state.interview.set({ document, proposals, limit: 20 })
  return { context, called, shown }
}

describe('interviewSection', () => {
  it('is left out while teaching is switched off', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(serverInfo({ teaching: false }))
    expect(sectionOf(context)).toBeNull()
    expect(called('refreshInterview')).toEqual([])
  })

  it('loads the proposals, and says once when they could not load, with a way to try again', () => {
    const { context, called } = testContext()
    const shown = mount(sectionOf(context)!)
    expect(called('refreshInterview')).toHaveLength(1)
    expect(textOf(shown)).toBe(`${strings.teach.chat.title}${strings.loading}`)
    setLoad(context.state.interview, { step: 'failed' })
    expect(textOf(shown)).toContain(strings.loadFailed)
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('askAgain')).toHaveLength(1)
  })

  it('draws nothing again for the same data, so that what is typed stays', () => {
    const { context, shown } = shownWith([], 'Old notes')
    const document = getByRole(shown, 'textbox', { name: /Principles document/ })
    fire.type(document, 'Refunds: 30 days.')
    context.state.interview.set({ document: 'Old notes', proposals: [], limit: 20 })
    expect(getByRole(shown, 'textbox', { name: /Principles document/ })).toBe(document)
    expect((document as HTMLTextAreaElement).value).toBe('Refunds: 30 days.')
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

  it('keeps what the person typed and has not saved when a new proposal or a saved card draws it again', () => {
    const { context, called, shown } = shownWith([proposal()], 'Old notes')
    const documentNow = () =>
      getByRole(shown, 'textbox', { name: /Principles document/ }) as HTMLTextAreaElement
    const cardNow = () => shown.querySelector<HTMLElement>('[data-proposal="prop_aaaaaaaaaaaa"]')!
    const ruleNow = () => cardNow().querySelector('textarea')!
    fire.type(documentNow(), 'Half a document')
    fire.type(ruleNow(), 'Half a rule')
    const second = proposal({ id: 'prop_bbbbbbbbbbbb' as never, topic: 'Holidays' })
    context.state.interview.set({ document: 'Old notes', proposals: [proposal(), second], limit: 20 })
    expect(documentNow().value).toBe('Half a document')
    expect(ruleNow().value).toBe('Half a rule')
    expect(cardNow().querySelector('details')!.hasAttribute('open')).toBe(true)
    getByRole(shown, 'button', { name: strings.teach.chat.documentSave }).click()
    called('saveTeachingDocument')[0]!.then!.done!(undefined)
    fire.type(ruleNow(), proposal().rule)
    context.state.interview.set({ document: 'Saved elsewhere', proposals: [proposal()], limit: 20 })
    expect(documentNow().value).toBe('Saved elsewhere')
    expect(cardNow().querySelector('details')!.hasAttribute('open')).toBe(false)
    fire.type(documentNow(), 'Typed again')
    getByRole(shown, 'button', { name: strings.teach.chat.documentRemove }).click()
    context.state.interview.set({ document: null, proposals: [], limit: 20 })
    expect(documentNow().value).toBe('')
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

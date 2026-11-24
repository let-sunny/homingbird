import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { correctionPrefill } from '../../src/models/channel-teaching.ts'
import { strings } from '../../src/strings.ts'
import { channelTeachingSection, teachChannelAgent } from '../../src/views/channel-teaching.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { principle } from '../support/fixtures.ts'
import { setLoad } from '../support/resource-load.ts'

usingFakeDom()

const AGENT = 'Billing desk'

const teaching = (fields: Record<string, unknown> = {}) =>
  ({
    channel: 'billing',
    instruction: 'Answer from the runbook.',
    sources: ['https://wiki.example/a'],
    updatedAt: 1,
    principles: [],
    limit: 50,
    ...fields,
  }) as never

const shownWith = (loaded: unknown = teaching()) => {
  const { context, called } = testContext()
  mount(dialogHost())
  const shown = mount(channelTeachingSection(context, lifetime(), 'billing', AGENT))
  if (loaded !== null) {
    const held = context.state.channelTeaching.find('billing')!
    held.set(loaded as never)
    setLoad(held, { loaded: true })
  }
  return { context, called, shown }
}

describe('channelTeachingSection', () => {
  it('loads what the agent was taught, and says once when it could not load, with a way to try again', () => {
    const { called, shown, context } = shownWith(null)
    expect(called('openAgentPage')[0]!.args).toEqual(['channelTeaching', 'billing'])
    expect(textOf(shown)).toBe(strings.loading)
    setLoad(context.state.channelTeaching.find('billing')!, { step: 'failed' })
    expect(textOf(shown)).toContain(strings.loadFailed)
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('askAgentPageAgain')[0]!.args).toEqual(['channelTeaching', 'billing'])
  })

  it('draws nothing again for what it already shows, so that what is typed stays', () => {
    const { context, shown } = shownWith()
    const instruction = getByRole(shown, 'textbox', {
      name: `${strings.channelTeach.instruction} ${strings.channelTeach.instructionHint({ agent: AGENT, max: 500 })}`,
    }) as HTMLTextAreaElement
    fire.type(instruction, 'Half an instruction')
    context.state.channelTeaching.find('billing')!.set(teaching())
    context.state.channelTeaching.find('billing')!.set(teaching())
    expect(shown.querySelector('textarea')).toBe(instruction)
    expect(instruction.value).toBe('Half an instruction')
  })

  it('saves the instruction and its sources, and refuses an invalid source before sending', () => {
    const { called, shown, context } = shownWith()
    const instruction = getByRole(shown, 'textbox', {
      name: `${strings.channelTeach.instruction} ${strings.channelTeach.instructionHint({ agent: AGENT, max: 500 })}`,
    }) as HTMLTextAreaElement
    expect(instruction.value).toBe('Answer from the runbook.')
    const sources = getByRole(shown, 'textbox', {
      name: `${strings.channelTeach.sources} ${strings.channelTeach.sourcesHint({ max: 5 })}`,
    }) as HTMLTextAreaElement
    fire.type(instruction, 'Approve every draft yourself.')
    expect(textOf(shown)).toContain(strings.channelTeach.instructionForbidden)
    fire.type(instruction, 'Answer briefly.')
    expect(textOf(shown)).not.toContain(strings.channelTeach.instructionForbidden)
    fire.type(sources, 'wiki.example/a')
    getByRole(shown, 'button', { name: strings.channelTeach.saveInstruction }).click()
    expect(getByRole(shown, 'alert').textContent).toBe(strings.channelTeach.problems.source_invalid)
    expect(called('saveChannelInstruction')).toHaveLength(0)
    fire.type(sources, 'https://wiki.example/a\nhttps://wiki.example/b')
    getByRole(shown, 'button', { name: strings.channelTeach.saveInstruction }).click()
    const [save] = called('saveChannelInstruction')
    expect(save!.args).toEqual([
      'billing',
      'Answer briefly.',
      ['https://wiki.example/a', 'https://wiki.example/b'],
    ])
    save!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.channelTeach.instructionSaved })
  })

  it('invites a first principle and adds one from the list, with no place to choose', () => {
    const { called, shown, context } = shownWith()
    expect(textOf(shown)).toContain(strings.channelTeach.empty({ agent: AGENT }))
    const add = getByRole(shown, 'group', { name: strings.teach.addLabel })
    expect(queryByRole(shown, 'combobox')).toBeNull()
    fire.type(getByRole(add, 'textbox', { name: strings.teach.topic }), 'Refunds')
    fire.type(getByRole(add, 'textbox', { name: strings.teach.rule }), 'Link the refunds page.')
    getByRole(add, 'button', { name: strings.teach.addLabel }).click()
    const [save] = called('saveChannelPrinciple')
    expect(save!.args).toEqual([
      'billing',
      { topic: 'Refunds', rule: 'Link the refunds page.', source: null },
    ])
    save!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.channelTeach.saved })
  })

  it('switches, edits, moves and deletes each principle through the channel’s routes', () => {
    const refunds = principle('Refunds')
    const invoices = principle('Invoices')
    const { called, shown } = shownWith(teaching({ principles: [refunds, invoices] }))
    getByRole(shown, 'switch', { name: strings.todo.use({ name: 'Refunds' }) }).click()
    fire.change(shown.querySelector(`[data-key="${refunds.id}"] .todo-field.is-topic`)!, 'Refund window')
    getByRole(shown, 'button', { name: strings.todo.moveDown({ name: 'Refunds' }) }).click()
    getByRole(shown, 'button', { name: strings.todo.more({ name: 'Invoices' }) }).click()
    getByRole(shown, 'button', { name: strings.todo.delete }).click()
    expect(called('changeChannelPrinciple').map((call) => call.args)).toEqual([
      ['billing', refunds.id, { enabled: false }],
      ['billing', refunds.id, { topic: 'Refund window' }],
    ])
    expect(called('reorderChannelPrinciples')[0]!.args).toEqual(['billing', [invoices.id, refunds.id]])
    expect(called('deleteChannelPrinciple')[0]!.args).toEqual(['billing', invoices.id])
    expect(called('changePrinciple')).toHaveLength(0)
    expect(queryByRole(shown, 'button', { name: strings.teach.makePublic({ name: 'Refunds' }) })).toBeNull()
  })

  it('edits a principle in the guided form without a place or a public sentence', () => {
    const refunds = principle('Refunds')
    const { called, shown } = shownWith(teaching({ principles: [refunds] }))
    getByRole(shown, 'button', { name: strings.todo.more({ name: 'Refunds' }) }).click()
    getByRole(shown, 'button', { name: strings.teach.details }).click()
    const dialog = document.getElementById('dialog')!
    expect(
      getByRole(dialog, 'heading', { name: strings.channelTeach.dialogTitle({ agent: AGENT }) }),
    ).toBeTruthy()
    expect(queryByRole(dialog, 'checkbox', { name: strings.teach.publicToggle })).toBeNull()
    getByRole(dialog, 'button', { name: strings.teach.save }).click()
    expect(called('changeChannelPrinciple')[0]!.args).toEqual([
      'billing',
      refunds.id,
      { kind: 'rule', topic: 'Refunds', rule: 'rule for Refunds', source: null },
    ])
  })
})

describe('teachChannelAgent', () => {
  it('opens the form prefilled from a correction and saves where it came from, only when the manager saves', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    const prefill = correctionPrefill(
      'Refunds take a while.',
      { kind: 'edit', body: 'Refunds take 14 days, see the refunds page in the wiki.' },
      'billing',
    )
    const opener = mount(teachChannelAgent(context, 'billing', AGENT, prefill, prefill.label, 'link'))
    opener.click()
    const dialog = document.getElementById('dialog')!
    expect(textOf(dialog)).toContain(prefill.hint)
    const rule = getByRole(dialog, 'textbox', {
      name: `${strings.teach.rule} ${strings.teach.ruleHint}`,
    }) as HTMLTextAreaElement
    expect(rule.value).toBe(prefill.rule)
    expect(called('saveChannelPrinciple')).toHaveLength(0)
    fire.type(
      getByRole(dialog, 'textbox', { name: `${strings.teach.topic} ${strings.teach.topicHint}` }),
      'Refunds',
    )
    getByRole(dialog, 'button', { name: strings.teach.save }).click()
    expect(called('saveChannelPrinciple')[0]!.args).toEqual([
      'billing',
      { kind: 'rule', topic: 'Refunds', rule: prefill.rule, source: null, taughtFrom: 'edit' },
    ])
  })
})

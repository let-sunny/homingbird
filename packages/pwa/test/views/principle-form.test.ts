import { fire, getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { dialogHost, showDialog } from '../../src/views/dialog.ts'
import { principleForm } from '../../src/views/principle-form.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ROOM, principle } from '../support/fixtures.ts'

usingFakeDom()

const open = (context: ReturnType<typeof testContext>['context'], ...args: [unknown, unknown, boolean]) => {
  const dialog = mount(dialogHost())
  showDialog(context, 'Teach', () => principleForm(context, args[0] as never, args[1] as never, args[2]))
  return dialog
}

describe('principleForm', () => {
  it('words the form for a stored answer, warns while typing, and creates the principle', () => {
    const { context, called } = testContext()
    const dialog = open(context, null, null, false)
    fire.type(
      getByRole(dialog, 'textbox', { name: `${strings.teach.topic} ${strings.teach.topicHint}` }),
      'Hours',
    )
    fire.type(dialog.querySelector('textarea[name="rule"]')!, 'We open at 9 on weekdays.')
    getByRole(dialog, 'button', { name: strings.teach.switchToAnswer }).click()
    expect(dialog.querySelector('.field-label')!.textContent).not.toBe('')
    expect(
      (getByRole(dialog, 'radio', { name: strings.teach.kinds.answer }) as HTMLInputElement).checked,
    ).toBe(true)
    fire.type(dialog.querySelector('input[name="source"]')!, 'https://wiki.example.com/hours')
    expect(dialog.querySelector('.source-host')!.textContent).toBe(
      strings.teach.sourceHost({ host: 'wiki.example.com' }),
    )
    fire.submit(dialog.querySelector('form')!)
    const [save] = called('savePrinciple')
    expect(save!.args[0]).toMatchObject({
      kind: 'answer',
      topic: 'Hours',
      source: 'https://wiki.example.com/hours',
    })
    save!.then!.done!(undefined)
    expect(dialog.open).toBe(false)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.saved })
  })

  it('shows what is wrong instead of saving', () => {
    const { context, called } = testContext()
    const dialog = open(context, null, null, false)
    fire.submit(dialog.querySelector('form')!)
    expect(getByRole(dialog, 'alert').textContent).toBe(strings.teach.problems.rule_empty)
    expect(called('savePrinciple')).toHaveLength(0)
  })

  it('asks to confirm an unchanged suggestion before it is saved', () => {
    const { context, called } = testContext()
    const offer = {
      id: 'offer_aaaaaaaaaaaa',
      kind: 'edit',
      noteId: 'n',
      conversationId: ROOM,
      place: null,
      suggestion: { added: 'Tuesday', removed: null },
      createdAt: 1,
    }
    const dialog = open(context, offer, null, false)
    const save = getByRole(dialog, 'button', { name: strings.teach.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    getByRole(dialog, 'checkbox', { name: strings.teach.confirm }).click()
    expect(save.disabled).toBe(false)
    fire.type(
      getByRole(dialog, 'textbox', { name: `${strings.teach.topic} ${strings.teach.topicHint}` }),
      'Days',
    )
    fire.submit(dialog.querySelector('form')!)
    expect(called('savePrinciple')[0]!.args[0]).toMatchObject({
      offerId: 'offer_aaaaaaaaaaaa',
      confirmed: true,
    })
  })

  it('changes the principle being edited, with its public sentence', () => {
    const { context, called } = testContext()
    const tone = principle('Tone', { place: 'billing' })
    const dialog = open(context, null, tone, true)
    expect((dialog.querySelector('.principle-public') as HTMLElement).hidden).toBe(false)
    expect((dialog.querySelector('select[name="place"]') as HTMLSelectElement).disabled).toBe(true)
    fire.type(dialog.querySelector('input[name="publicText"]')!, 'Answers kindly.')
    getByRole(dialog, 'checkbox', { name: strings.teach.publicToggle }).click()
    getByRole(dialog, 'checkbox', { name: strings.teach.publicToggle }).click()
    fire.submit(dialog.querySelector('form')!)
    expect(called('changePrinciple')[0]!.args).toEqual([
      tone.id,
      { kind: 'rule', topic: 'Tone', rule: 'rule for Tone', source: null, publicText: 'Answers kindly.' },
    ])
  })
})

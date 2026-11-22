import { fire, getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { autoSendForm } from '../../src/views/auto-send-form.ts'
import { dialogHost, showDialog } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, ROOM, conversation, entry, me, principle } from '../support/fixtures.ts'

usingFakeDom()

const answer = (autoSend = { enabled: false, places: [] as never[] }) =>
  principle('Office hours', { kind: 'answer', rule: 'Nine to five.', autoSend })

const open = (shown: ReturnType<typeof answer>) => {
  const test = testContext()
  test.context.state.session.set(me())
  test.context.state.conversations.set([conversation({ id: ROOM, participantIds: [ANA, BEN] })])
  test.context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
  const dialog = mount(dialogHost())
  showDialog(test.context, 'Auto', () => autoSendForm(test.context, shown))
  return { ...test, dialog }
}

describe('autoSendForm', () => {
  it('switches a saved answer on for the places the person ticks, then says so', () => {
    const { dialog, called, context } = open(answer())
    getByRole(dialog, 'checkbox', { name: strings.autoSend.switchLabel }).click()
    getByRole(dialog, 'checkbox', { name: 'Ben' }).click()
    fire.submit(dialog.querySelector('form')!)
    const [saved] = called('setAutoSend')
    expect(saved!.args).toEqual([answer().id, { enabled: true, places: [ROOM] }])
    saved!.then!.done!(undefined)
    expect(dialog.open).toBe(false)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.autoSend.saved })
  })

  it('asks for a place instead of saving a switch with nowhere to send', () => {
    const { dialog, called } = open(answer())
    getByRole(dialog, 'checkbox', { name: strings.autoSend.switchLabel }).click()
    fire.submit(dialog.querySelector('form')!)
    expect(getByRole(dialog, 'alert').textContent).toBe(strings.autoSend.needsPlace)
    expect(called('setAutoSend')).toHaveLength(0)
  })

  it('turns it off, and says every draft waits again', () => {
    const { dialog, called, context } = open(answer({ enabled: true, places: [ROOM as never] }))
    getByRole(dialog, 'checkbox', { name: strings.autoSend.switchLabel }).click()
    fire.submit(dialog.querySelector('form')!)
    const [saved] = called('setAutoSend')
    expect(saved!.args[1]).toEqual({ enabled: false, places: [ROOM] })
    saved!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.autoSend.turnedOff })
  })

  it('shows nothing for a rule', () => {
    const { context } = testContext()
    expect(autoSendForm(context, principle('Tone'))).toBeNull()
  })
})

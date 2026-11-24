import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { consentView, deviceView } from '../../src/views/connect.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { BEN, CY, channel, everything } from '../support/fixtures.ts'

usingFakeDom()

const device = { userCode: 'ABCD-EFGH', client: 'Claude Code' }
const consent = { id: 'consent_1', client: 'Desk', redirectHost: 'desk.example.com' }

describe('deviceView', () => {
  it('asks for the code a device shows, and goes to it', () => {
    const { context, page } = testContext()
    const shown = deviceView(context, lifetime(), null)
    fire.type(getByRole(shown, 'textbox', { name: strings.deviceCodeLabel }), ' abcd ')
    fire.submit(shown.querySelector('form')!)
    expect(page.visited).toEqual(['go #/device/abcd'])
    expect(getByRole(shown, 'link', { name: strings.backToConnect }).getAttribute('href')).toBe(
      '#/agent/connection',
    )
  })

  it('looks the code up, approves under a name, and says it is connected', () => {
    const { context, called } = testContext()
    const shown = deviceView(context, lifetime(), 'ABCD-EFGH')
    expect(textOf(shown)).toContain(strings.loading)
    const [lookUp] = called('lookUpDevice')
    expect(lookUp!.then!.attempt).toBe('device')
    lookUp!.then!.done!(device)
    fire.type(getByRole(shown, 'textbox', { name: strings.deviceNameLabel }), ' Laptop ')
    fire.submit(shown.querySelector('form')!)
    const [decide] = called('decideDevice')
    expect(decide!.args).toEqual(['ABCD-EFGH', true, 'Laptop', ''])
    decide!.then!.done!(undefined)
    expect(getByRole(shown, 'heading', { name: strings.connectedTitle })).toBeTruthy()
  })

  it('keeps the name typed and the channel’s agent chosen while the channels are read again', () => {
    const { context, called } = testContext()
    const wiki = channel('wiki', { runsAgent: true, agent: { id: CY, name: 'Wiki' } })
    context.state.serverInfo.set(everything())
    context.state.channels.set([wiki])
    const shown = deviceView(context, lifetime(), 'ABCD-EFGH')
    called('lookUpDevice')[0]!.then!.done!(device)
    fire.type(getByRole(shown, 'textbox', { name: strings.deviceNameLabel }), 'Server')
    fire.select(shown.querySelector('select')!, 'wiki')
    context.state.channels.set([wiki, channel('ops', { runsAgent: true, agent: { id: BEN, name: 'Ops' } })])
    fire.submit(shown.querySelector('form')!)
    expect(called('decideDevice')[0]!.args).toEqual(['ABCD-EFGH', true, 'Server', 'wiki'])
  })

  it('denies under the device’s own name, and asks again for a code that was refused', () => {
    const { context, called } = testContext()
    const shown = deviceView(context, lifetime(), 'ABCD-EFGH')
    called('lookUpDevice')[0]!.then!.done!(device)
    fire.type(getByRole(shown, 'textbox', { name: strings.deviceNameLabel }), '  ')
    getByRole(shown, 'button', { name: strings.deny }).click()
    expect(called('decideDevice')[0]!.args).toEqual(['ABCD-EFGH', false, 'Claude Code', ''])
    called('decideDevice')[0]!.then!.done!(undefined)
    expect(textOf(shown)).toContain(strings.deviceDenied)
    const again = deviceView(context, lifetime(), 'WRONG')
    called('lookUpDevice')[1]!.then!.failed!({ _tag: 'NotFound', message: 'no' })
    expect(getByRole(again, 'textbox', { name: strings.deviceCodeLabel })).toBeTruthy()
  })
})

describe('consentView', () => {
  it('asks the person, approves, then returns to the agent after a moment', () => {
    const { context, called } = testContext()
    const shown = consentView(context, lifetime(), 'consent_1')
    expect(textOf(shown)).toContain(strings.loading)
    called('lookUpConsent')[0]!.then!.done!(consent)
    expect(textOf(shown)).toContain(strings.consentReturnsTo({ host: 'desk.example.com' }))
    fire.submit(shown.querySelector('form')!)
    const [decide] = called('decideConsent')
    expect(decide!.args).toEqual(['consent_1', true, 'Desk'])
    decide!.then!.done!({ redirectTo: 'https://desk.example.com/back' })
    expect(textOf(shown)).toContain(strings.consentApproved({ host: 'desk.example.com' }))
    expect(called('returnAfterAMoment')[0]!.args).toEqual(['https://desk.example.com/back'])
  })

  it('denies too', () => {
    const { context, called } = testContext()
    const shown = consentView(context, lifetime(), 'consent_1')
    called('lookUpConsent')[0]!.then!.done!(consent)
    getByRole(shown, 'button', { name: strings.deny }).click()
    expect(called('decideConsent')[0]!.args[1]).toBe(false)
  })
})

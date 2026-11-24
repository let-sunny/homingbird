import { lifetime } from '@homingbird/ui'
import { fire, getByRole, getByText, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { connectionSection } from '../../src/views/connection.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, channel, credential, entry, me, report, serverInfo } from '../support/fixtures.ts'
import { setLoad, setWorkspace } from '../support/resource-load.ts'

usingFakeDom()

describe('connectionSection', () => {
  it('recommends a desk, shows its state and suggests a fresh session where one is due', () => {
    const { context, called } = testContext()
    const shown = connectionSection(context, lifetime(), me())
    expect(shown.querySelector('.desk-recommendation')).toBeNull()
    context.state.credentials.set([credential('cred_desk')])
    expect(textOf(shown.querySelector('.desk-recommendation')!)).toContain(strings.deskTitle)
    context.state.directory.set([entry(ANA, 'Ana', { presence: { humanOnline: true, agentOnline: true } })])
    expect(textOf(shown.querySelector('.desk-state')!)).toContain(strings.selfPresence.agentOnline)
    expect([...shown.children][0]!.querySelector('.desk-state')).not.toBeNull()
    expect(shown.querySelector('.desk-recommendation')).toBeNull()
    context.state.agentReport.set(
      report({
        sessions: {
          days: 30,
          byAge: [],
          byContext: [],
          latest: [{ agentName: 'Laptop', ageMinutes: 600, contextPercent: null, at: 1 }],
        },
      }),
    )
    expect(textOf(shown)).toContain(strings.trust.sessions.freshSuggestion({ name: 'Laptop' }))
    context.state.agentReport.reset()
    expect(shown.querySelector('.fresh-session')).toBeNull()
  })

  it('lists the person’s credentials, and renames or revokes one', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    const shown = mount(connectionSection(context, lifetime(), me()))
    expect(textOf(shown)).toContain(strings.loading)
    context.state.credentials.set([
      credential('cred_laptop', { name: 'Laptop' }),
      credential('cred_old', { revokedAt: 3 }),
    ])
    expect(queryByRole(shown, 'paragraph')).toBeNull()
    const laptop = shown.querySelector('[data-credential-id="cred_laptop"]')!
    getByRole(laptop, 'button', { name: strings.rename }).click()
    const dialog = document.getElementById('dialog')!
    fire.type(getByRole(dialog, 'textbox', { name: strings.renameLabel }), ' Desk ')
    fire.submit(dialog.querySelector('form')!)
    expect(called('renameCredential')[0]!.args).toEqual(['cred_laptop', 'Desk'])
    called('renameCredential')[0]!.then!.done!(undefined)
    expect(called('reloadCredentials')).toHaveLength(1)
    getByRole(laptop, 'button', { name: strings.revoke }).click()
    getByRole(dialog, 'button', { name: strings.revoke }).click()
    called('revokeCredential')[0]!.then!.done!(undefined)
    expect(called('reloadCredentials')).toHaveLength(2)
    expect(shown.querySelector('[data-credential-id="cred_old"] .credential-actions')).toBeNull()
  })

  it('says once that the devices and agents could not load, nothing while the line above says it, and lists them once they came', () => {
    const { context, called } = testContext()
    const shown = mount(connectionSection(context, lifetime(), me()))
    expect(called('loadCredentials')).toHaveLength(1)
    setWorkspace(context.state, 'failed')
    setLoad(context.state.credentials, { step: 'failed' })
    expect(queryByRole(shown, 'button', { name: strings.tryAgain })).toBeNull()
    setWorkspace(context.state, 'loaded')
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('askAgain')).toHaveLength(1)
    context.state.credentials.set([credential('cred_laptop', { name: 'Laptop' })])
    setLoad(context.state.credentials, { loaded: true })
    expect(queryByRole(shown, 'button', { name: strings.tryAgain })).toBeNull()
    expect(textOf(shown.querySelector('.connected-agents')!)).toContain('Laptop')
  })

  it('signs out of this browser after revoking its own credential, and says when no agent is connected', () => {
    const { context, called, page } = testContext()
    mount(dialogHost())
    const shown = mount(connectionSection(context, lifetime(), me()))
    context.state.credentials.set([credential('cred_web', { kind: 'human', current: true })])
    expect(getByText(shown, strings.noAgentsYet)).toBeTruthy()
    getByRole(shown, 'button', { name: strings.revoke }).click()
    getByRole(document.getElementById('dialog')!, 'button', { name: strings.revoke }).click()
    called('revokeCredential')[0]!.then!.done!(undefined)
    expect(page.visited).toEqual(['assign /'])
  })

  it('lists the first steps with no agent, then the sign-in command until an agent credential can be used', () => {
    const { context, called, clock } = testContext()
    const shown = mount(connectionSection(context, lifetime(), me()))
    expect(shown.querySelector('.first-steps')).toBeNull()
    context.state.credentials.set([credential('cred_web', { kind: 'human', current: true })])
    const steps = shown.querySelector('.first-steps')!
    expect(textOf(steps)).toContain(strings.firstSteps.title)
    expect(textOf(steps)).toContain('homingbird login --server http://localhost')
    expect(getByRole(steps, 'link', { name: strings.firstSteps.guide }).getAttribute('rel')).toBe(
      'noopener noreferrer',
    )
    expect(shown.querySelector('.service-banner')).toBeNull()
    expect(textOf(shown)).not.toContain('administrator')
    expect(shown.querySelector('.desk-recommendation')).toBeNull()
    context.state.credentials.set([credential('cred_old', { expiresAt: clock.now() - 1 })])
    const another = shown.querySelector('details.first-steps')!
    expect(another.hasAttribute('open')).toBe(false)
    expect(textOf(another.querySelector('summary')!)).toBe(strings.firstSteps.anotherTitle)
    expect(textOf(another)).toContain('/homingbird http://localhost')
    expect(textOf(shown.querySelector('.service-banner')!)).toContain(
      `${strings.serviceBanner.title}${strings.serviceBanner.bodyWithJoin}homingbird login --server http://localhost`,
    )
    context.state.credentials.set([credential('cred_desk', { expiresAt: clock.now() + 1 })])
    expect(shown.querySelector('.service-banner')).toBeNull()
  })

  it('names the channels the agent answers in, and none', () => {
    const { context } = testContext()
    const shown = connectionSection(context, lifetime(), me())
    expect(textOf(shown)).not.toContain(strings.noChannelsHelped)
    expect(textOf(shown)).toContain(strings.checking.channels)
    setWorkspace(context.state, 'failed')
    expect(textOf(shown)).not.toContain(strings.noChannelsHelped)
    setWorkspace(context.state, 'loaded')
    expect(textOf(shown)).toContain(strings.noChannelsHelped)
    context.state.channels.set([channel('billing', { answering: true })])
    expect(getByRole(shown, 'link', { name: '#billing' })).toBeTruthy()
  })

  it('offers a cloud desk only where the server has the feature on', () => {
    const off = testContext()
    const without = connectionSection(off.context, lifetime(), me())
    expect(without.querySelector('.cloud-desk')).toBeNull()
    expect(off.called('loadDeskWake')).toEqual([])
    const on = testContext()
    on.context.state.serverInfo.set(serverInfo({ cloudDesk: true }))
    const shown = connectionSection(on.context, lifetime(), me())
    expect(textOf(shown.querySelector('.cloud-desk')!)).toContain(strings.cloudDesk.legend)
    expect(on.called('loadDeskWake')).toHaveLength(1)
  })

  it('offers to run the agent on a server only where the server offers join codes, and says so in the banner', () => {
    const on = testContext()
    const shown = connectionSection(on.context, lifetime(), me())
    expect(textOf(shown.querySelector('.join-code')!)).toContain(strings.joinCode.title)
    on.context.state.credentials.set([])
    expect(textOf(shown.querySelector('.first-steps')!)).toContain(strings.firstSteps.joinHint)
    const off = testContext()
    off.context.state.serverInfo.set(serverInfo({ joinCodes: false }))
    const without = connectionSection(off.context, lifetime(), me())
    expect(without.querySelector('.join-code')).toBeNull()
    off.context.state.credentials.set([])
    expect(textOf(without.querySelector('.first-steps')!)).not.toContain(strings.firstSteps.joinHint)
  })
})

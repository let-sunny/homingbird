import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { settingsSection } from '../../src/views/admin-settings.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { everything, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const settings = { allowedDomains: ['example.com'], contactMode: 'open' as const }

describe('settingsSection', () => {
  it('saves the domains, the contact mode, the answering flow and the features, and says so', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    const shown = mount(settingsSection(context, lifetime()))
    expect(textOf(shown)).toContain(strings.loading)
    called('loadSettings')[0]!.then!.done!(settings)
    fire.type(
      getByRole(shown, 'textbox', { name: `${strings.allowedDomains} ${strings.allowedDomainsHint}` }),
      'Example.com, acme.io',
    )
    fire.select(getByRole(shown, 'combobox', { name: strings.contactMode }), 'contacts')
    getByRole(shown, 'switch', { name: strings.features.names.teaching }).click()
    getByRole(shown, 'button', { name: strings.answeringFlow.insertExample }).click()
    expect(
      (getByRole(shown, 'button', { name: strings.answeringFlow.insertExample }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fire.submit(shown.querySelector('form')!)
    const [save] = called('saveSettings')
    expect(save!.args[0]).toMatchObject({
      allowedDomains: ['example.com', 'acme.io'],
      contactMode: 'contacts',
      features: { teaching: false },
    })
    expect(typeof (save!.args[0] as { answeringFlow: unknown }).answeringFlow).toBe('string')
    save!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.saved })
    save!.then!.failed!({ _tag: 'Invalid', message: 'Too long.' })
    expect(getByRole(shown, 'alert').textContent).toBe('Too long.')
  })

  it('keeps an unknown contact mode from being saved until a known one is chosen', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(serverInfo())
    const shown = settingsSection(context, lifetime())
    called('loadSettings')[0]!.then!.done!({ ...settings, contactMode: 'unknown' })
    expect((getByRole(shown, 'button', { name: strings.save }) as HTMLButtonElement).disabled).toBe(true)
    fire.submit(shown.querySelector('form')!)
    expect(called('saveSettings')).toHaveLength(0)
    expect(queryByRole(shown, 'group', { name: strings.answeringFlow.title })).toBeNull()
    fire.select(getByRole(shown, 'combobox', { name: strings.contactMode }), 'open')
    fire.submit(shown.querySelector('form')!)
    expect(called('saveSettings')[0]!.args[0]).not.toHaveProperty('answeringFlow')
  })

  it('edits the answering flow as two lists of steps', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    const shown = mount(settingsSection(context, lifetime()))
    called('loadSettings')[0]!.then!.done!({ ...settings, answeringFlow: null })
    const lists = shown.querySelectorAll('.answering-flow .todo-add')
    const before = lists[0]! as HTMLElement
    const add = (text: string) => {
      fire.type(getByRole(before, 'textbox', { name: strings.answeringFlow.stepLabel }), text)
      getByRole(before, 'button', { name: strings.answeringFlow.addStep }).click()
    }
    add('Read the question')
    add('Check the wiki')
    const flow = () => shown.querySelector('.answering-flow')! as HTMLElement
    expect(textOf(flow())).not.toContain(`${strings.answeringFlow.exampleNeedsEmpty}x`)
    getByRole(flow(), 'switch', { name: strings.todo.use({ name: 'Read the question' }) }).click()
    getByRole(flow(), 'button', { name: strings.todo.moveDown({ name: 'Read the question' }) }).click()
    fire.change(flow().querySelector('[data-name="Check the wiki"] .todo-field')!, 'Check the docs')
    getByRole(flow(), 'button', { name: strings.todo.more({ name: 'Check the docs' }) }).click()
    getByRole(flow(), 'button', { name: strings.todo.delete }).click()
    getByRole(flow(), 'button', { name: strings.answeringFlow.insertExample }).click()
    fire.submit(shown.querySelector('form')!)
    expect((called('saveSettings')[0]!.args[0] as { answeringFlow: string }).answeringFlow).toContain(
      'Read the question',
    )
    expect((called('saveSettings')[0]!.args[0] as { answeringFlow: string }).answeringFlow).not.toContain(
      'docs',
    )
  })
})

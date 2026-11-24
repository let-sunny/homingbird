import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { adminChannelsSection } from '../../src/views/admin-channels.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { channel } from '../support/fixtures.ts'
import { setLoad, setWorkspace } from '../support/resource-load.ts'

usingFakeDom()

describe('adminChannelsSection', () => {
  it('lets the line above offer to try again when channels could not load, and says when there are none', () => {
    const { context, called } = testContext()
    const shown = adminChannelsSection(context, lifetime())
    expect(called('loadKnownChannels')).toHaveLength(1)
    expect(textOf(shown)).toContain(strings.loading)
    setWorkspace(context.state, 'failed')
    expect(textOf(shown)).not.toContain(strings.loading)
    expect(textOf(shown)).not.toContain(strings.adminNoChannels)
    setLoad(context.state.channels, { loaded: true })
    expect(textOf(shown)).toContain(strings.adminNoChannels)
  })

  it('renames a channel and archives one, moving its members', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    context.state.channels.set([channel('billing'), channel('ops')])
    setLoad(context.state.channels, { loaded: true })
    const shown = mount(adminChannelsSection(context, lifetime()))
    const billing = shown.querySelector('[data-slug="billing"]')!
    getByRole(billing, 'button', { name: strings.editChannel }).click()
    const dialog = document.getElementById('dialog')!
    const slug = getByRole(dialog, 'textbox', {
      name: `${strings.channelSlugLabel} ${strings.channelSlugHint}`,
    }) as HTMLInputElement
    fire.type(slug, 'Bills-')
    expect(slug.value).toBe('bills-')
    fire.type(getByRole(dialog, 'textbox', { name: strings.channelDescriptionLabel }), ' Money ')
    fire.submit(dialog.querySelector('form')!)
    expect(called('reviseChannel')[0]!.args).toEqual(['billing', { slug: 'bills', description: 'Money' }])
    getByRole(billing, 'button', { name: strings.editChannel }).click()
    fire.submit(dialog.querySelector('form')!)
    expect(called('reviseChannel')[1]!.args).toEqual(['billing', { description: 'About billing' }])
    getByRole(billing, 'button', { name: strings.archiveChannel }).click()
    const into = getByRole(dialog, 'combobox', { name: strings.moveMembersInto }) as HTMLSelectElement
    expect(into.disabled).toBe(true)
    getByRole(dialog, 'checkbox', { name: strings.moveMembersTo }).click()
    expect(into.disabled).toBe(false)
    fire.submit(dialog.querySelector('form')!)
    expect(called('archiveChannel')[0]!.args).toEqual(['billing', 'ops'])
    context.state.channels.set([channel('billing')])
    getByRole(shown.querySelector('[data-slug="billing"]')!, 'button', {
      name: strings.archiveChannel,
    }).click()
    fire.submit(dialog.querySelector('form')!)
    expect(called('archiveChannel')[1]!.args).toEqual(['billing', null])
  })
})

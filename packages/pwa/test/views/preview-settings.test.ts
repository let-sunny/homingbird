import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { previewSettingsSection } from '../../src/views/preview-settings.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { BEN, CY, channel, entry, me } from '../support/fixtures.ts'

usingFakeDom()

const shownWith = () => {
  const test = testContext()
  test.context.state.directory.set([entry(BEN, 'Ben'), entry(CY, 'Cy')])
  test.context.state.channels.set([channel('ops', { joined: true })])
  const shown = mount(previewSettingsSection(test.context, lifetime(), me()))
  return { ...test, shown }
}

describe('previewSettingsSection', () => {
  it('loads the people and channels and the allowance, then ticks what is allowed', () => {
    const { shown, called } = shownWith()
    expect(called('loadPeople')).toHaveLength(1)
    expect(called('loadKnownChannels')).toHaveLength(1)
    expect(textOf(shown)).toContain(strings.loading)
    called('loadPreviewAllowance')[0]!.then!.done!({ people: [BEN], channels: [] })
    expect(textOf(shown)).toContain(strings.draftPreviews.intro)
    expect((getByRole(shown, 'checkbox', { name: 'Ben' }) as HTMLInputElement).checked).toBe(true)
    expect((getByRole(shown, 'checkbox', { name: 'Cy' }) as HTMLInputElement).checked).toBe(false)
    expect((getByRole(shown, 'checkbox', { name: '#ops' }) as HTMLInputElement).checked).toBe(false)
  })

  it('says when the allowance could not be read', () => {
    const { shown, called } = shownWith()
    called('loadPreviewAllowance')[0]!.then!.failed!({})
    expect(textOf(shown)).toContain(strings.loadFailed)
  })

  it('saves the ticked people and channels, and says it saved', () => {
    const { shown, called } = shownWith()
    called('loadPreviewAllowance')[0]!.then!.done!({ people: [BEN], channels: [] })
    fire.click(getByRole(shown, 'checkbox', { name: '#ops' }))
    fire.click(getByRole(shown, 'checkbox', { name: 'Cy' }))
    fire.event(shown.querySelector('form')!, 'submit')
    const [save] = called('savePreviewAllowance')
    expect(save!.args).toEqual([{ people: [BEN, CY], channels: ['ops'] }])
    save!.then!.done!({ people: [BEN, CY], channels: ['ops'] })
    expect(textOf(shown)).toContain(strings.draftPreviews.saved)
  })
})

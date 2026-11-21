import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { readdressForm } from '../../src/views/channel-picker.ts'
import { dialogHost, showDialog } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { channel, draft } from '../support/fixtures.ts'

usingFakeDom()

const here = channel('here', { joined: true })

const setup = () => {
  const test = testContext()
  test.context.state.channels.set([here, channel('billing', { joined: true })])
  const dialog = mount(dialogHost())
  return { ...test, dialog }
}

describe('readdressForm', () => {
  it('sends a draft to another channel', () => {
    const { context, called, dialog } = setup()
    const pending = draft('d1')
    showDialog(context, 'Change', (life) => readdressForm(context, life, pending, 'here'))
    fire.submit(dialog.querySelector('form')!)
    expect(called('readdressDraft')[0]!.args).toEqual([pending, 'billing'])
    called('readdressDraft')[0]!.then!.done!(undefined)
    expect(context.state.notice.get()).toBeNull()
    showDialog(context, 'Change', (life) => readdressForm(context, lifetime() && life, pending, 'here'))
    getByRole(dialog, 'radio', {
      name: `${strings.newChannelInline} ${strings.newChannelInlineHint}`,
    }).click()
    fire.type(
      getByRole(dialog, 'textbox', { name: `${strings.channelSlugLabel} ${strings.channelSlugHint}` }),
      'ops',
    )
    fire.type(getByRole(dialog, 'textbox', { name: strings.channelDescriptionLabel }), 'Ops')
    fire.submit(dialog.querySelector('form')!)
    expect(called('createChannelThenReaddress')[0]!.args[1]).toBe(pending)
  })

  it('says when the channel made on the way was made but the draft still goes to the old one', () => {
    const { context, called, dialog } = setup()
    context.state.channels.set([])
    showDialog(context, 'Change', (life) => readdressForm(context, life, draft('d1'), 'here'))
    fire.submit(dialog.querySelector('form')!)
    expect(called('createChannelThenReaddress')).toEqual([])
    const slug = getByRole(dialog, 'textbox', {
      name: `${strings.channelSlugLabel} ${strings.channelSlugHint}`,
    }) as HTMLInputElement
    fire.type(slug, 'New Room')
    expect(slug.value).toBe('new-room')
    fire.type(getByRole(dialog, 'textbox', { name: strings.channelDescriptionLabel }), 'Somewhere new')
    fire.submit(dialog.querySelector('form')!)
    const [create] = called('createChannelThenReaddress')
    expect(create!.args[0]).toEqual({ slug: 'new-room', description: 'Somewhere new' })
    create!.then!.done!({ created: channel('new-room'), failure: { _tag: 'Forbidden', message: 'No.' } })
    expect(context.state.notice.get()).toMatchObject({ kind: 'error', link: { href: '#/channel/new-room' } })
    context.state.notice.set(null)
    create!.then!.done!({ created: channel('new-room'), failure: null })
    expect(context.state.notice.get()).toBeNull()
    expect(dialog.open).toBe(false)
  })
})

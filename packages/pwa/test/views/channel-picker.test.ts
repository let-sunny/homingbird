import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { moveForm, readdressForm } from '../../src/views/channel-picker.ts'
import { dialogHost, showDialog } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { channel, draft, note } from '../support/fixtures.ts'

usingFakeDom()

const here = channel('here', { joined: true })

const setup = () => {
  const test = testContext()
  test.context.state.channels.set([here, channel('billing', { joined: true })])
  const dialog = mount(dialogHost())
  return { ...test, dialog }
}

describe('moveForm', () => {
  it('moves a question to the channel chosen and says where it went', () => {
    const { context, called, dialog } = setup()
    const question = note('q', { conversationId: here.conversationId })
    showDialog(context, 'Move', (life) => moveForm(context, life, question, here.conversationId))
    expect(textOf(dialog)).toContain(strings.moveIntro)
    fire.submit(dialog.querySelector('form')!)
    const [move] = called('moveQuestion')
    expect(move!.args).toEqual([question, 'billing'])
    expect(move!.then!.attempt).toBe('move')
    move!.then!.done!(undefined)
    expect(dialog.open).toBe(false)
    expect(context.state.notice.get()).toEqual({
      kind: 'info',
      text: strings.questionMoved({ channel: '#billing' }),
      link: { href: `#/c/${channel('billing').conversationId}`, label: strings.openRoom },
    })
    context.state.channels.set([])
    showDialog(context, 'Move', (life) => moveForm(context, life, question, here.conversationId))
    fire.submit(dialog.querySelector('form')!)
  })

  it('moves to a channel made on the way, and says when the channel was made but the move failed', () => {
    const { context, called, dialog } = setup()
    showDialog(context, 'Move', (life) => moveForm(context, life, note('q'), here.conversationId))
    getByRole(dialog, 'radio', {
      name: `${strings.newChannelInline} ${strings.newChannelInlineHint}`,
    }).click()
    const slug = getByRole(dialog, 'textbox', {
      name: `${strings.channelSlugLabel} ${strings.channelSlugHint}`,
    }) as HTMLInputElement
    fire.type(slug, 'New Room')
    expect(slug.value).toBe('new-room')
    fire.submit(dialog.querySelector('form')!)
    expect(called('createChannelThenMove')).toHaveLength(0)
    fire.type(getByRole(dialog, 'textbox', { name: strings.channelDescriptionLabel }), 'Somewhere new')
    fire.submit(dialog.querySelector('form')!)
    const [create] = called('createChannelThenMove')
    expect(create!.args[0]).toEqual({ slug: 'new-room', description: 'Somewhere new' })
    create!.then!.done!({ created: channel('new-room'), failure: { _tag: 'Forbidden', message: 'No.' } })
    expect(context.state.notice.get()).toMatchObject({ kind: 'error', link: { href: '#/channel/new-room' } })
    create!.then!.done!({ created: channel('new-room'), failure: null })
    expect(context.state.notice.get()).toMatchObject({
      kind: 'info',
      text: strings.questionMoved({ channel: '#new-room' }),
    })
  })
})

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
})

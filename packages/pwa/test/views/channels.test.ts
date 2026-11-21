import { lifetime } from '@homingbird/ui'
import { fire, getByRole, getByText, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { channelView, channelsView } from '../../src/views/channels.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, settle, usingFakeDom } from '../support/dom.ts'
import { channel, conversation, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const page = (channels: ReturnType<typeof channel>[], hasMore = false) => ({
  channels,
  hasMore,
  cursor: hasMore ? 'next' : null,
})

describe('channelsView', () => {
  it('loads a page of channels, invites the first one, and searches what is typed', () => {
    const { context, called } = testContext()
    const shown = channelsView(context, lifetime())
    expect(textOf(shown)).toContain(strings.loading)
    called('loadChannelPage')[0]!.then!.done!(page([]))
    expect(textOf(shown)).toContain(strings.noChannelsYet)
    fire.type(getByRole(shown, 'searchbox'), ' bill ')
    const [, search] = called('loadChannelPage')
    expect(search!.args).toEqual(['bill', null])
    called('loadChannelPage')[0]!.then!.done!(page([channel('stale')]))
    expect(textOf(shown)).toContain(strings.noChannelsYet)
    search!.then!.done!(page([]))
    expect(textOf(shown)).toContain(strings.noChannels)
  })

  it('shows each card, the hint for the only channel, more on request, and joins one', () => {
    const { context, called } = testContext()
    const shown = channelsView(context, lifetime())
    called('loadChannelPage')[0]!.then!.done!(page([channel('billing')]))
    expect(textOf(shown)).toContain(strings.onlyOneChannel)
    expect(getByRole(shown, 'link', { name: '#billing' }).getAttribute('href')).toBe('#/channel/billing')
    getByRole(shown, 'button', { name: strings.join }).click()
    expect(called('joinChannel')[0]!.args).toEqual(['billing', false])
    const more = getByRole(shown, 'button', { name: strings.channelMore({ channel: '#billing' }) })
    const menu = shown.querySelector<HTMLElement>(`#${more.getAttribute('popovertarget')}`)!
    expect(menu.getAttribute('popover')).toBe('auto')
    getByRole(menu, 'button', { name: strings.joinAndAnswer }).click()
    expect(called('joinChannel')[1]!.args).toEqual(['billing', true])
    called('loadChannelPage')[0]!.then!.done!(page([channel('billing')], true))
    getByRole(shown, 'button', { name: strings.showMoreChannels }).click()
    expect(called('loadChannelPage')[1]!.args).toEqual(['', 'next'])
    called('loadChannelPage')[1]!.then!.done!(page([channel('ops', { joined: true })]))
    expect(getByRole(shown, 'link', { name: '#ops' })).toBeTruthy()
  })

  it('reloads a short list when the known channels change, and updates a long one in place', () => {
    const { context, called } = testContext()
    const shown = channelsView(context, lifetime())
    context.state.channels.set([channel('billing')])
    expect(called('loadChannelPage')).toHaveLength(2)
    const many = Array.from({ length: 21 }, (_, index) => channel(`c${index}`))
    called('loadChannelPage')[1]!.then!.done!(page(many))
    context.state.channels.set([channel('c0', { description: 'Renamed' })])
    expect(called('loadChannelPage')).toHaveLength(2)
    expect(getByText(shown, 'Renamed')).toBeTruthy()
  })

  it('creates a channel, warning about one that exists, and opens it', () => {
    const { context, called, page: browser } = testContext()
    mount(dialogHost())
    context.state.channels.set([channel('billing')])
    const shown = mount(channelsView(context, lifetime()))
    getByRole(shown, 'button', { name: strings.newChannel }).click()
    const dialog = document.getElementById('dialog')!
    const slug = getByRole(dialog, 'textbox', {
      name: `${strings.channelSlugLabel} ${strings.channelSlugHint}`,
    }) as HTMLInputElement
    fire.type(slug, 'Bill')
    expect(slug.value).toBe('bill')
    expect(textOf(dialog)).toContain(strings.similarChannels)
    fire.type(slug, 'billing')
    expect((getByRole(dialog, 'button', { name: strings.createChannel }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fire.submit(dialog.querySelector('form')!)
    expect(called('createChannel')).toHaveLength(0)
    fire.type(slug, 'ops')
    fire.type(getByRole(dialog, 'textbox', { name: strings.channelDescriptionLabel }), ' Operations ')
    expect(textOf(dialog)).toContain(strings.visibilityFixed)
    getByRole(dialog, 'radio', { name: strings.visibilityPrivate }).click()
    fire.submit(dialog.querySelector('form')!)
    const [create] = called('createChannel')
    expect(create!.args).toEqual(['ops', 'Operations', 'private'])
    expect(create!.then!.attempt).toBe('channel-name')
    create!.then!.done!(channel('ops'))
    expect(browser.visited).toEqual(['go #/channel/ops'])
    expect((dialog as HTMLDialogElement).open).toBe(false)
  })

  it('leaves out starting a channel where channels are off', () => {
    const { context } = testContext()
    context.state.serverInfo.set(serverInfo())
    expect(queryByRole(channelsView(context, lifetime()), 'button', { name: strings.newChannel })).toBeNull()
  })
})

describe('channelView', () => {
  it('waits for the channels, then says when there is no such channel', () => {
    const { context } = testContext()
    const shown = channelView(context, lifetime(), 'billing')
    expect(textOf(shown)).toContain(strings.loading)
    context.state.channelsLoaded.set(true)
    expect(textOf(shown)).toContain(strings.unknownChannel)
  })

  it('asks an open channel a question and enters its room, and joins it', async () => {
    const { context, called } = testContext()
    const billing = channel('billing', { helperCount: 2 })
    context.state.channels.set([billing])
    const shown = channelView(context, lifetime(), 'billing')
    expect(
      getByRole(shown, 'heading', { name: strings.askChannelTitle({ channel: '#billing' }) }),
    ).toBeTruthy()
    fire.submit(shown.querySelector('form.ask-channel')!)
    expect(called('askChannel')).toHaveLength(0)
    fire.type(getByRole(shown, 'textbox', { name: strings.askChannelPlaceholder }), ' When? ')
    fire.submit(shown.querySelector('form.ask-channel')!)
    called('askChannel')[0]!.then!.done!(billing.conversationId)
    expect(called('enterRoom')[0]!.args).toEqual([billing.conversationId])
    getByRole(shown, 'button', { name: strings.join }).click()
    expect(called('joinChannel')[0]!.args).toEqual(['billing', false])
    await settle()
  })

  it('opens the room of a channel the person is in, and only names a private one they are not in', async () => {
    const { context, page } = testContext()
    const secret = channel('secret', { visibility: 'private' })
    context.state.channels.set([secret])
    const shown = channelView(context, lifetime(), 'secret')
    expect(getByRole(shown, 'heading', { name: '#secret' })).toBeTruthy()
    expect(shown.querySelector('form.ask-channel')).toBeNull()
    context.state.conversations.set([conversation({ id: secret.conversationId })])
    expect(page.visited).toEqual([`replace #/c/${secret.conversationId}`])
    await settle()
  })
})

import { lifetime } from '@homingbird/ui'
import { allByRole, fire, getByRole, getByText, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { browserDocument } from '../../src/page-document.ts'
import type { AppState } from '../../src/state.ts'
import { strings } from '../../src/strings.ts'
import { channelView, channelsView } from '../../src/views/channels.ts'
import { createViewContext } from '../../src/views/context.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { hold, testApp } from '../support/app.ts'
import { testContext } from '../support/context.ts'
import { mount, settle, usingFakeDom } from '../support/dom.ts'
import { CY, channel, conversation, serverInfo } from '../support/fixtures.ts'
import { setLoad, setWorkspace } from '../support/resource-load.ts'

usingFakeDom()

const page = (channels: ReturnType<typeof channel>[], hasMore = false) => ({
  channels,
  hasMore,
  cursor: hasMore ? 'next' : null,
})

const listed = (state: AppState, found: ReturnType<typeof page>, query = ''): void => {
  state.channelPage.set({ query, ...found })
  setLoad(state.channelPage, { loaded: true })
}

describe('channelsView', () => {
  it('opens the first page, invites the first channel, and searches what is typed', () => {
    const { context, called } = testContext()
    const shown = channelsView(context, lifetime())
    expect(called('openChannelPage')).toHaveLength(1)
    expect(textOf(shown)).toContain(strings.checking.channels)
    expect(textOf(shown)).not.toContain(strings.noChannelsYet)
    listed(context.state, page([]))
    expect(textOf(shown)).toContain(strings.noChannelsYet)
    fire.type(getByRole(shown, 'searchbox'), ' bill ')
    expect(called('loadChannelPage')[0]!.args).toEqual(['bill', null])
    listed(context.state, page([]), 'bill')
    expect(textOf(shown)).toContain(strings.noChannels)
  })

  it('says it is taking too long or failed in place of the list, and Try again loads the typed page again', () => {
    const { context, called } = testContext()
    const shown = mount(channelsView(context, lifetime()))
    setLoad(context.state.channelPage, { step: 'long' })
    expect(textOf(shown)).toContain(strings.firstLoad.tooLong)
    expect(textOf(shown)).not.toContain(strings.noChannelsYet)
    context.state.channelPageWish.set({ query: 'bill', after: null })
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('loadChannelPage')[0]!.args).toEqual(['bill', null])
    setLoad(context.state.channelPage, { step: 'failed' })
    expect(textOf(shown)).toContain(strings.loadFailed)
    expect(allByRole(shown, 'button', { name: strings.tryAgain })).toHaveLength(1)
    listed(context.state, page([]))
    expect(textOf(shown)).toContain(strings.noChannelsYet)
    expect(queryByRole(shown, 'button', { name: strings.tryAgain })).toBeNull()
  })

  it('says nothing of its own while the line above offers to try again', () => {
    const { context } = testContext()
    const shown = mount(channelsView(context, lifetime()))
    setLoad(context.state.channelPage, { step: 'long' })
    for (const workspace of ['long', 'failed'] as const) {
      setWorkspace(context.state, workspace)
      expect(textOf(shown)).not.toContain(strings.firstLoad.tooLong)
      expect(textOf(shown)).not.toContain(strings.noChannelsYet)
      expect(queryByRole(shown, 'button', { name: strings.tryAgain })).toBeNull()
    }
    setWorkspace(context.state, 'loaded')
    expect(textOf(shown)).toContain(strings.firstLoad.tooLong)
  })

  it('shows each card, the hint for the only channel, more on request, and joins one', () => {
    const { context, called } = testContext()
    const shown = mount(channelsView(context, lifetime()))
    listed(context.state, page([channel('billing')]))
    expect(textOf(shown)).toContain(strings.onlyOneChannel)
    expect(getByRole(shown, 'link', { name: '#billing' }).getAttribute('href')).toBe('#/channel/billing')
    getByRole(shown, 'button', { name: strings.join }).click()
    expect(called('joinChannel')[0]!.args).toEqual(['billing', false])
    const more = getByRole(shown, 'button', { name: strings.channelMore({ channel: '#billing' }) })
    const menu = shown.querySelector<HTMLElement>(`#${more.getAttribute('popovertarget')}`)!
    expect(menu.getAttribute('popover')).toBe('auto')
    fire.event(shown.querySelector('[data-slug="billing"] .channel-description'), 'contextmenu')
    expect(menu.matches(':popover-open')).toBe(true)
    getByRole(menu, 'menuitem', { name: strings.joinAndAnswer }).click()
    expect(menu.matches(':popover-open')).toBe(false)
    expect(called('joinChannel')[1]!.args).toEqual(['billing', true])
    listed(context.state, page([channel('billing')], true))
    getByRole(shown, 'button', { name: strings.showMoreChannels }).click()
    expect(called('loadChannelPage')[0]!.args).toEqual(['', context.state.channelPage.get()])
    listed(context.state, page([channel('billing'), channel('ops', { joined: true })]))
    expect(getByRole(shown, 'link', { name: '#ops' })).toBeTruthy()
  })

  it('keeps an open menu open when the list is loaded again with the same channels', () => {
    const { context } = testContext()
    const shown = mount(channelsView(context, lifetime()))
    listed(context.state, page([channel('billing'), channel('deploys')]))
    const more = getByRole(shown, 'button', { name: strings.channelMore({ channel: '#deploys' }) })
    const menu = shown.querySelector<HTMLElement>(`#${more.getAttribute('popovertarget')}`)!
    menu.showPopover()
    listed(context.state, page([channel('billing'), channel('deploys')]))
    expect(menu.isConnected).toBe(true)
    expect(menu.matches(':popover-open')).toBe(true)
    listed(context.state, page([channel('billing'), channel('deploys', { joined: true })]))
    expect(menu.isConnected).toBe(false)
  })

  it('newest wins while channels change: one page is read again, several are updated in place, and a search is never undone', async () => {
    const first = page(
      [channel('a'), ...Array.from({ length: 19 }, (_, index) => channel(`c${index}`))],
      true,
    )
    const next = [hold<unknown>(), hold<unknown>()]
    const answers = [first, first, page([channel('b')]), next[0]!.waiting, next[1]!.waiting]
    let asked = 0
    const { app, state, sent } = testApp({
      'channels.list': (request) =>
        (request as { query: { limit: string } }).query.limit === '20'
          ? answers[asked++]
          : page([channel('a')]),
    })
    const context = createViewContext(
      app,
      browserDocument(() => document),
    )
    const shown = mount(channelsView(context, lifetime()))
    await settle()
    getByRole(shown, 'button', { name: strings.showMoreChannels }).click()
    await settle()
    expect(getByRole(shown, 'link', { name: '#b' })).toBeTruthy()
    state.channels.set([channel('a', { description: 'Renamed' })])
    await settle()
    expect(getByText(shown, 'Renamed')).toBeTruthy()
    fire.type(getByRole(shown, 'searchbox'), 'z')
    await settle()
    state.channels.set([channel('a', { description: 'Renamed again' })])
    next[0]!.release(page([channel('z')]))
    await settle()
    expect(getByRole(shown, 'link', { name: '#z' })).toBeTruthy()
    expect(queryByRole(shown, 'link', { name: '#a' })).toBeNull()
    next[1]!.release(page([channel('zz')]))
    await settle()
    expect(allByRole(shown, 'link').map((link) => link.textContent)).toContain('#zz')
    expect(sent.filter((one) => JSON.stringify(one.request).includes('"q":"z"'))).toHaveLength(2)
    app.endSession()
  })

  it('keeps the pages shown while the next is on its way, and says below them that it did not come, with Try again', () => {
    const { context, called } = testContext()
    const shown = mount(channelsView(context, lifetime()))
    listed(context.state, page([channel('billing')], true))
    context.state.channelPageWish.set({ query: '', after: context.state.channelPage.get() })
    setLoad(context.state.channelPage, { step: 'loading' })
    const more = getByRole(shown, 'button', { name: strings.showMoreChannels })
    expect(textOf(shown)).toContain(strings.checking.channels)
    expect(more).toBeTruthy()
    setLoad(context.state.channelPage, { step: 'failed' })
    expect(getByRole(shown, 'link', { name: '#billing' })).toBeTruthy()
    expect(queryByRole(shown, 'button', { name: strings.showMoreChannels })).toBeNull()
    const again = allByRole(shown, 'button', { name: strings.tryAgain })
    expect(again).toHaveLength(1)
    again[0]!.click()
    expect(called('loadChannelPage')[0]!.args).toEqual(['', context.state.channelPage.get()])
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
    expect(textOf(shown)).toContain(strings.checking.channels)
    setLoad(context.state.channels, { loaded: true })
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

  it('says beside joining, on the card and on the channel’s page, that the channel’s own agent drafts its answers', () => {
    const { context, called } = testContext()
    const billing = channel('billing', { agent: { id: CY, name: 'Billing helper' } })
    const note = strings.answeredByChannelAgent({ agent: 'Billing helper', channel: '#billing' })
    context.state.channels.set([billing])
    expect(
      channelView(context, lifetime(), 'billing').querySelector('.answering-agent-note')?.textContent,
    ).toBe(note)
    const list = channelsView(context, lifetime())
    listed(context.state, page([billing]))
    expect(list.querySelector('[data-slug="billing"] .answering-agent-note')?.textContent).toBe(note)
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

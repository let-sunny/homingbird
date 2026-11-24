import { describe, expect, it } from 'vitest'
import type { ListedChannels } from '../../src/channels.ts'
import {
  askPageModel,
  channelListModel,
  joinedRoom,
  listAfterChange,
  nameCheck,
  slugToCreate,
  withPage,
} from '../../src/models/channels.ts'
import { strings } from '../../src/strings.ts'
import { CY, channel, conversation } from '../support/fixtures.ts'

const listed = (fields: Partial<ListedChannels> = {}): ListedChannels => ({
  query: '',
  channels: [],
  hasMore: false,
  cursor: null,
  ...fields,
})

describe('channelListModel', () => {
  it('waits, invites the first channel, or says none matched what was typed', () => {
    expect(channelListModel(listed(), 'loading', 'loaded')).toEqual({
      kind: 'waiting',
      wait: { kind: 'checking', text: strings.checking.channels },
    })
    expect(channelListModel(listed(), null, 'loaded')).toEqual({
      kind: 'none-yet',
      text: strings.noChannelsYet,
    })
    expect(channelListModel(listed({ query: 'x' }), null, 'loaded')).toEqual({
      kind: 'no-match',
      text: strings.noChannels,
    })
  })

  it('says it is taking too long or could not load, with Try again', () => {
    expect(channelListModel(listed(), 'long', 'loaded')).toEqual({
      kind: 'waiting',
      wait: { kind: 'long', text: strings.firstLoad.tooLong, retry: strings.tryAgain },
    })
    expect(channelListModel(listed(), 'failed', 'loaded')).toEqual({
      kind: 'waiting',
      wait: { kind: 'failed', text: strings.loadFailed, retry: strings.tryAgain },
    })
  })

  it('shows each card with where the person stands, joining only an open channel, a hint and more to load', () => {
    const only = channelListModel(
      listed({ channels: [channel('billing', { answering: true, joined: true })] }),
      null,
      'loaded',
    )
    if (only.kind !== 'channels') throw new Error('expected channels')
    expect(only.onlyOne).toBe(strings.onlyOneChannel)
    expect(only.more).toBeNull()
    expect(only.cards[0]).toMatchObject({
      className: 'channel-card is-helping ',
      label: '#billing',
      href: '#/channel/billing',
      status: { text: strings.helpingHere, className: 'kind is-helping' },
      join: null,
    })
    const many = channelListModel(
      listed({
        channels: [channel('a', { joined: true }), channel('b', { visibility: 'private' }), channel('c')],
        hasMore: true,
      }),
      null,
      'loaded',
    )
    if (many.kind !== 'channels') throw new Error('expected channels')
    expect(many.onlyOne).toBeNull()
    expect(many.more).toBe(strings.showMoreChannels)
    expect(many.cards.map((card) => [card.status?.text ?? null, card.join, card.className])).toEqual([
      [strings.inRoom, null, 'channel-card  '],
      [null, null, 'channel-card  is-private'],
      [
        null,
        {
          label: strings.join,
          more: strings.channelMore({ channel: '#c' }),
          joinAndAnswer: strings.joinAndAnswer,
        },
        'channel-card  ',
      ],
    ])
  })

  it('says why the person’s agent drafts nothing in a channel with its own agent, where they answer or could join to', () => {
    const agent = { id: CY, name: 'Billing helper' }
    const listing = channelListModel(
      listed({
        channels: [
          channel('a', { agent }),
          channel('b', { agent, joined: true, answering: true }),
          channel('c', { agent, joined: true }),
          channel('d', { joined: true, answering: true }),
        ],
      }),
      null,
      'loaded',
    )
    if (listing.kind !== 'channels') throw new Error('expected channels')
    expect(listing.cards.map((card) => card.agentNote)).toEqual([
      strings.answeredByChannelAgent({ agent: 'Billing helper', channel: '#a' }),
      strings.answeredByChannelAgent({ agent: 'Billing helper', channel: '#b' }),
      null,
      null,
    ])
  })
})

describe('paging the list', () => {
  it('reloads a short list after a change and updates a long one in place', () => {
    const known = [channel('a', { memberCount: 9 })]
    expect(listAfterChange(listed({ channels: [channel('a')] }), known, 20)).toBe('reload')
    const long = listed({
      channels: [channel('a'), ...Array.from({ length: 20 }, (_, i) => channel(`z${i}`))],
    })
    const next = listAfterChange(long, known, 20)
    expect(next !== 'reload' && next.channels[0]!.memberCount).toBe(9)
  })

  it('adds a page to what was listed, or starts again for a new query', () => {
    const page = { channels: [channel('b')], hasMore: true, cursor: 'c2' }
    expect(withPage(listed({ channels: [channel('a')] }), '', page)).toEqual(
      listed({ channels: [channel('a'), channel('b')], hasMore: true, cursor: 'c2' }),
    )
    expect(withPage(null, 'b', page)).toEqual(
      listed({ query: 'b', channels: [channel('b')], hasMore: true, cursor: 'c2' }),
    )
  })
})

describe('askPageModel', () => {
  it('asks an open channel, says when nobody answers, and offers to join', () => {
    expect(askPageModel(channel('billing', { helperCount: 2 }))).toEqual({
      title: strings.askChannelTitle({ channel: '#billing' }),
      description: 'About billing',
      mayJoin: true,
      managing: false,
      seesMembers: false,
      intro: strings.askChannelIntro({ count: 2 }),
      mayAsk: true,
    })
    expect(askPageModel(channel('billing', { helperCount: 0 })).intro).toBe(strings.askChannelNobodyAnswers)
  })

  it('only names a private channel the person is not in, and lets an administrator see its members', () => {
    expect(askPageModel(channel('secret', { visibility: 'private' }))).toMatchObject({
      title: '#secret',
      mayAsk: false,
      intro: null,
      mayJoin: false,
      seesMembers: false,
    })
    expect(askPageModel(channel('secret', { visibility: 'private' }), true)).toMatchObject({
      managing: false,
      seesMembers: true,
    })
    expect(askPageModel(channel('ops'), true).seesMembers).toBe(false)
  })
})

describe('joinedRoom', () => {
  it('finds the room of a channel the person is in', () => {
    const billing = channel('billing')
    expect(joinedRoom([billing], [conversation({ id: billing.conversationId })], 'billing')).toBe(
      billing.conversationId,
    )
    expect(joinedRoom([billing], [], 'billing')).toBeNull()
    expect(joinedRoom([], [], 'billing')).toBeNull()
  })
})

describe('naming a new channel', () => {
  const channels = [channel('billing'), channel('billing-eu')]

  it('says a name exists already, or names similar ones', () => {
    expect(nameCheck(channels, 'billing-')).toEqual({
      kind: 'exists',
      text: strings.channelExists({ channel: '#billing' }),
      href: '#/channel/billing',
    })
    expect(nameCheck(channels, 'bill')).toEqual({ kind: 'similar', slugs: ['billing', 'billing-eu'] })
    expect(nameCheck(channels, 'ops')).toEqual({ kind: 'free' })
  })

  it('creates only a valid name nobody has', () => {
    expect(slugToCreate(channels, '#Ops Team-')).toBe('ops-team')
    expect(slugToCreate(channels, 'billing')).toBeNull()
    expect(slugToCreate(channels, '---')).toBeNull()
  })
})

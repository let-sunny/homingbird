import { Task as T } from '@homingbird/kernel'
import { CHANNEL_DESCRIPTION_MAX, type Channel, NOTE_BODY_MAX } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import {
  CHANNEL_PAGE,
  type ChannelPage,
  askChannel,
  createChannel,
  launch,
  loadChannelPage,
  loadChannels,
  loadConversations,
} from '../actions.ts'
import {
  channelLabel,
  channelNamed,
  isPrivate,
  isValidSlug,
  similarChannels,
  slugFrom,
  withChannel,
} from '../channels.ts'
import { featureOn } from '../features.ts'
import { hrefFor } from '../routes.ts'
import { channels, channelsLoaded, conversations } from '../state.ts'
import { strings } from '../strings.ts'
import { agentAsk } from './agent-ask.ts'
import { joinButtons, privateMark, roomControls, rosters } from './channel-membership.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { channelChips, channelCounts, emptyWithPip, field, page } from './parts.ts'
import { pip } from './pip.ts'

export const channelsView = (life: Lifetime): HTMLElement => {
  launch(loadChannels(''))
  const query = signal('')
  const listed = signal<ListedChannels>({
    query: '',
    channels: [],
    hasMore: false,
    cursor: null,
    loaded: false,
  })
  const load = (typed: string, after: ListedChannels | null): void =>
    launch(loadChannelPage(typed, after?.cursor ?? null), (found: ChannelPage) => {
      if (query.get() !== typed) return
      listed.set({
        query: typed,
        channels: [...(after?.channels ?? []), ...found.channels],
        hasMore: found.hasMore,
        cursor: found.cursor,
        loaded: true,
      })
    })
  life.add(
    channels.subscribe((known) => {
      const current = listed.get()
      if (current.channels.length <= CHANNEL_PAGE) return load(query.get(), null)
      listed.set({
        ...current,
        channels: current.channels.map(
          (shown) => known.find((channel) => channel.slug === shown.slug) ?? shown,
        ),
      })
    }),
  )
  const search = h('input', {
    type: 'search',
    name: 'q',
    placeholder: strings.channelsSearchPlaceholder,
    on: {
      input: () => {
        const typed = search.value.trim()
        query.set(typed)
        load(typed, null)
      },
    },
  })
  load('', null)
  return page(
    strings.channels,
    h('div', { class: 'channels-intro' }, h('p', {}, strings.channelsIntro), newChannelButton()),
    field(strings.channelsSearchLabel, search),
    region(life, [listed], () => {
      const current = listed.get()
      if (!current.loaded) return h('p', { class: 'loading' }, strings.loading)
      if (current.channels.length === 0 && current.query === '')
        return emptyWithPip(
          'searching',
          4,
          strings.noChannelsYet,
          h('div', { class: 'empty-actions' }, newChannelButton(), peopleLink()),
        )
      if (current.channels.length === 0) return emptyWithPip('searching', 4, strings.noChannels)
      return [
        h('ul', { class: 'channel-list' }, current.channels.map(channelCard)),
        current.query === '' &&
          current.channels.length === 1 &&
          !current.hasMore &&
          h('p', { class: 'hint only-one-channel' }, strings.onlyOneChannel),
        current.hasMore &&
          h(
            'button',
            { type: 'button', class: 'show-more', on: { click: () => load(current.query, current) } },
            strings.showMoreChannels,
          ),
      ]
    }),
  )
}

export const newChannelButton = (): HTMLElement | null =>
  !featureOn('channels')
    ? null
    : h(
        'button',
        {
          type: 'button',
          class: 'primary new-channel',
          ...opensDialog(strings.createChannelTitle, createForm),
        },
        strings.newChannel,
      )

export const channelView = (life: Lifetime, slug: string): HTMLElement => {
  launch(loadChannels(''))
  const roomOf = (): string | null => {
    const channel = channelNamed(channels.get(), slug)
    const joined = channel !== null && conversations.get().some((room) => room.id === channel.conversationId)
    return joined ? channel.conversationId : null
  }
  const enterRoomIfJoined = (): void => {
    const room = roomOf()
    if (room !== null) location.replace(hrefFor({ name: 'conversation', id: room }))
  }
  life.add(channels.subscribe(enterRoomIfJoined))
  life.add(conversations.subscribe(enterRoomIfJoined))
  queueMicrotask(enterRoomIfJoined)
  return h(
    'div',
    { class: 'channel-ask-host' },
    region(life, [channels, channelsLoaded, rosters], () => {
      const channel = channelNamed(channels.get(), slug)
      if (channel === null && !channelsLoaded.get()) return h('p', { class: 'loading' }, strings.loading)
      if (channel === null)
        return emptyWithPip(
          'failed',
          4,
          strings.unknownChannel,
          h(
            'div',
            { class: 'empty-actions' },
            h('a', { class: 'button', href: hrefFor({ name: 'channels' }) }, strings.browseChannels),
            newChannelButton(),
          ),
        )
      return askPage(life, channel)
    }),
  )
}

interface ListedChannels {
  readonly query: string
  readonly channels: ReadonlyArray<Channel>
  readonly hasMore: boolean
  readonly cursor: string | null
  readonly loaded: boolean
}

const peopleLink = (): HTMLElement =>
  h('a', { class: 'button', href: hrefFor({ name: 'people' }) }, strings.askAPersonInstead)

const channelCard = (channel: Channel): HTMLElement =>
  h(
    'li',
    {
      class: `channel-card ${channel.answering ? 'is-helping' : ''} ${isPrivate(channel) ? 'is-private' : ''}`,
      data: { slug: channel.slug },
    },
    h(
      'div',
      { class: 'channel-main' },
      h(
        'h2',
        { class: 'channel-name' },
        h('a', { href: hrefFor({ name: 'channel', slug: channel.slug }) }, channelLabel(channel.slug)),
        privateMark(channel),
      ),
      h('p', { class: 'channel-description' }, channel.description),
      h(
        'p',
        { class: 'channel-meta' },
        channelCounts(channel),
        channel.answering
          ? h('span', { class: 'kind is-helping' }, strings.helpingHere)
          : channel.joined && h('span', { class: 'kind is-joined' }, strings.inRoom),
      ),
    ),
    h(
      'div',
      { class: 'channel-actions' },
      !channel.joined && !isPrivate(channel) && joinButtons(channel),
      h(
        'a',
        {
          class: `button ${channel.joined ? 'primary' : ''}`,
          href: hrefFor({ name: 'channel', slug: channel.slug }),
        },
        channel.joined || isPrivate(channel) ? strings.openRoom : strings.askChannel,
      ),
    ),
  )

const createForm = (life: Lifetime): HTMLElement => {
  const typed = signal('')
  const slug = h('input', {
    name: 'slug',
    required: true,
    maxlength: '40',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'billing',
    on: {
      input: () => {
        const normalized = slugFrom(slug.value)
        if (normalized !== slug.value) slug.value = normalized
        typed.set(normalized)
      },
    },
  })
  const description = h('input', {
    name: 'description',
    required: true,
    maxlength: String(CHANNEL_DESCRIPTION_MAX),
    placeholder: strings.channelDescriptionPlaceholder,
  })
  const visibility = visibilityChoice()
  const submit = h('button', { type: 'submit', class: 'primary' }, strings.createChannel)
  return h(
    'form',
    {
      class: 'dialog-body create-channel',
      on: {
        submit: (event) => {
          event.preventDefault()
          const wanted = slugFrom(slug.value).replace(/-+$/, '')
          if (!isValidSlug(wanted) || channelNamed(channels.get(), wanted) !== null) return
          const chosen = visibility.querySelector<HTMLInputElement>('input:checked')?.value
          launch(
            createChannel(wanted, description.value.trim(), chosen === 'private' ? 'private' : 'open'),
            (created) => {
              channels.update((all) => withChannel(all, created))
              closeDialog()
              location.hash = hrefFor({ name: 'channel', slug: created.slug })
            },
            'channel-name',
          )
        },
      },
    },
    field(strings.channelSlugLabel, slug, strings.channelSlugHint),
    region(
      life,
      [typed, channels],
      () => {
        const similar = similarChannels(channels.get(), typed.get())
        const exact = channelNamed(channels.get(), typed.get().replace(/-+$/, ''))
        submit.disabled = exact !== null
        if (exact !== null)
          return h(
            'p',
            { class: 'channel-exists', role: 'status' },
            pip('blocked', 2),
            h('span', {}, strings.channelExists({ channel: channelLabel(exact.slug) })),
            h(
              'a',
              { href: hrefFor({ name: 'channel', slug: exact.slug }), on: { click: closeDialog } },
              strings.openRoom,
            ),
          )
        return (
          similar.length > 0 &&
          h(
            'div',
            { class: 'channel-similar' },
            h('span', {}, strings.similarChannels),
            channelChips(similar.map((channel) => channel.slug)),
          )
        )
      },
      { class: 'channel-check' },
    ),
    field(strings.channelDescriptionLabel, description),
    visibility,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      submit,
    ),
  )
}

const visibilityChoice = (): HTMLFieldSetElement =>
  h(
    'fieldset',
    { class: 'visibility-choice' },
    h('legend', {}, strings.channelVisibility),
    h(
      'label',
      {},
      h('input', { type: 'radio', name: 'visibility', value: 'open', checked: true }),
      h('span', {}, strings.visibilityOpen),
    ),
    h(
      'label',
      {},
      h('input', { type: 'radio', name: 'visibility', value: 'private' }),
      h(
        'span',
        { class: 'private-choice' },
        h('span', { class: 'lock-mark', 'aria-hidden': 'true' }),
        strings.visibilityPrivate,
      ),
    ),
  )

const askPage = (life: Lifetime, channel: Channel): Child => {
  const text = h('textarea', {
    name: 'body',
    rows: '4',
    required: true,
    maxlength: String(NOTE_BODY_MAX),
    placeholder: strings.askChannelPlaceholder,
    'aria-label': strings.askChannelPlaceholder,
  })
  const enterRoom = (conversationId: string): void =>
    launch(T.asUnit(loadConversations), () => {
      location.hash = hrefFor({ name: 'conversation', id: conversationId })
    })
  const mayAsk = channel.joined || !isPrivate(channel)
  return page(
    mayAsk ? strings.askChannelTitle({ channel: channelLabel(channel.slug) }) : channelLabel(channel.slug),
    privateMark(channel),
    h('p', { class: 'channel-description' }, channel.description),
    h('p', { class: 'channel-meta' }, channelCounts(channel)),
    !channel.joined && !isPrivate(channel) && joinButtons(channel),
    channel.managing && roomControls(channel),
    mayAsk &&
      h(
        'p',
        {},
        channel.helperCount === 0
          ? strings.askChannelNobodyAnswers
          : strings.askChannelIntro({ count: channel.helperCount }),
      ),
    mayAsk &&
      h(
        'form',
        {
          class: 'form ask-channel',
          on: {
            submit: (event) => {
              event.preventDefault()
              const body = text.value.trim()
              if (body !== '') launch(askChannel(channel.slug, body), enterRoom)
            },
          },
        },
        text,
        h('button', { type: 'submit', class: 'primary' }, strings.send),
        agentAsk(
          life,
          () => ({ channel: channel.slug }),
          (request) => enterRoom(request.conversationId),
        ),
      ),
  )
}

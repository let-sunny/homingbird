import { CHANNEL_DESCRIPTION_MAX, NOTE_BODY_MAX } from '@homingbird/protocol'
import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { channelNamed, slugFrom } from '../channels.ts'
import { featureOn } from '../features.ts'
import {
  type ChannelCard,
  type ChannelListModel,
  type ListedChannels,
  askPageModel,
  channelListModel,
  joinedRoom,
  listAfterChange,
  nameCheck,
  slugToCreate,
  withPage,
} from '../models/channels.ts'
import { hrefFor } from '../routes.ts'
import { signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import { CHANNEL_PAGE } from '../tasks/channels.ts'
import { agentAsk } from './agent-ask.ts'
import { joinButtons, privateMark, roomControls } from './channel-membership.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { channelChips, channelCounts, empty, emptyWithPip, field, loading, page } from './parts.ts'

/** Channels: every channel the person may see, searchable, a page at a time. */
export const channelsView = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { state, actions } = context
  actions.loadKnownChannels()
  const query = signal('')
  const listed = signal<ListedChannels>({
    query: '',
    channels: [],
    hasMore: false,
    cursor: null,
    loaded: false,
  })
  const load = (typed: string, after: ListedChannels | null): void =>
    actions.loadChannelPage(typed, after?.cursor ?? null, {
      done: (found) => {
        if (query.get() === typed) listed.set(withPage(after, typed, found))
      },
    })
  life.add(
    state.channels.subscribe((known) => {
      const next = listAfterChange(listed.get(), known, CHANNEL_PAGE)
      if (next === 'reload') load(query.get(), null)
      else listed.set(next)
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
    h('div', { class: 'channels-intro' }, h('p', {}, strings.channelsIntro), newChannelButton(context)),
    field(strings.channelsSearchLabel, search),
    region(life, [listed], () =>
      renderChannelList(channelListModel(listed.get()), context, () =>
        load(listed.get().query, listed.get()),
      ),
    ),
  )
}

/** One channel's page, which opens its room for a member and offers to ask or join otherwise. */
export const channelView = (context: ViewContext, life: Lifetime, slug: string): HTMLElement => {
  const { state, actions } = context
  actions.loadKnownChannels()
  const enterRoomIfJoined = (): void => {
    const room = joinedRoom(state.channels.get(), state.conversations.get(), slug)
    if (room !== null) context.page.replace(hrefFor({ name: 'conversation', id: room }))
  }
  life.add(state.channels.subscribe(enterRoomIfJoined))
  life.add(state.conversations.subscribe(enterRoomIfJoined))
  queueMicrotask(enterRoomIfJoined)
  return h(
    'div',
    { class: 'channel-ask-host' },
    region(life, [state.channels, state.channelsLoaded, state.rosters], () => {
      const channel = channelNamed(state.channels.get(), slug)
      if (channel === null && !state.channelsLoaded.get()) return loading()
      if (channel === null)
        return emptyWithPip(
          'failed',
          strings.unknownChannel,
          h(
            'div',
            { class: 'empty-actions' },
            h('a', { class: 'button', href: hrefFor({ name: 'channels' }) }, strings.browseChannels),
            newChannelButton(context),
          ),
        )
      return askPage(context, life, channel)
    }),
  )
}

const channelCard = (card: ChannelCard, context: ViewContext): HTMLElement =>
  h(
    'li',
    { class: card.className, data: { slug: card.channel.slug } },
    h(
      'div',
      { class: 'channel-main' },
      h('h2', { class: 'channel-name' }, h('a', { href: card.href }, card.label), privateMark(card.channel)),
      h('p', { class: 'channel-description' }, card.channel.description),
      h(
        'p',
        { class: 'channel-meta' },
        channelCounts(card.channel),
        card.status !== null && h('span', { class: card.status.className }, card.status.text),
      ),
    ),
    h(
      'div',
      { class: 'channel-actions' },
      card.mayJoin && joinButtons(context, card.channel),
      h('a', { class: `button ${card.open.primary ? 'primary' : ''}`, href: card.href }, card.open.text),
    ),
  )

const createForm = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { state, actions } = context
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
          const wanted = slugToCreate(state.channels.get(), slug.value)
          if (wanted === null) return
          const chosen = visibility.querySelector<HTMLInputElement>('input:checked')?.value
          actions.createChannel(wanted, description.value.trim(), chosen === 'private' ? 'private' : 'open', {
            done: (created) => {
              closeDialog(context)
              context.page.go(hrefFor({ name: 'channel', slug: created.slug }))
            },
            attempt: 'channel-name',
          })
        },
      },
    },
    field(strings.channelSlugLabel, slug, strings.channelSlugHint),
    region(
      life,
      [typed, state.channels],
      () => {
        const check = nameCheck(state.channels.get(), typed.get())
        submit.disabled = check.kind === 'exists'
        if (check.kind === 'exists')
          return h(
            'p',
            { class: 'channel-exists', role: 'status' },
            h('span', {}, check.text),
            h('a', { href: check.href, on: { click: () => closeDialog(context) } }, strings.openRoom),
          )
        return (
          check.kind === 'similar' &&
          h(
            'div',
            { class: 'channel-similar' },
            h('span', {}, strings.similarChannels),
            channelChips(check.slugs),
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

const askPage = (context: ViewContext, life: Lifetime, channel: AsRead.Channel): Child => {
  const model = askPageModel(channel, signedIn(context.state)?.member.role === 'admin')
  const text = h('textarea', {
    name: 'body',
    rows: '4',
    required: true,
    maxlength: String(NOTE_BODY_MAX),
    placeholder: strings.askChannelPlaceholder,
    'aria-label': strings.askChannelPlaceholder,
  })
  const enterRoom = (conversationId: string): void => context.actions.enterRoom(conversationId)
  return page(
    model.title,
    privateMark(channel),
    h('p', { class: 'channel-description' }, model.description),
    h('p', { class: 'channel-meta' }, channelCounts(channel)),
    model.mayJoin && joinButtons(context, channel),
    model.seesMembers && roomControls(context, channel),
    model.intro !== null && h('p', {}, model.intro),
    model.mayAsk &&
      h(
        'form',
        {
          class: 'form ask-channel',
          on: {
            submit: (event) => {
              event.preventDefault()
              const body = text.value.trim()
              if (body !== '') context.actions.askChannel(channel.slug, body, { done: enterRoom })
            },
          },
        },
        text,
        h('button', { type: 'submit', class: 'primary' }, strings.send),
        agentAsk(
          context,
          life,
          () => ({ channel: channel.slug }),
          (request) => enterRoom(request.conversationId),
        ),
      ),
  )
}

const renderChannelList = (model: ChannelListModel, context: ViewContext, more: () => void): Child => {
  switch (model.kind) {
    case 'loading':
      return loading()
    case 'none-yet':
      return emptyWithPip(
        'searching',
        model.text,
        h(
          'div',
          { class: 'empty-actions' },
          newChannelButton(context),
          h('a', { class: 'button', href: hrefFor({ name: 'people' }) }, strings.askAPersonInstead),
        ),
      )
    case 'no-match':
      return empty(model.text)
    case 'channels':
      return [
        h(
          'ul',
          { class: 'channel-list' },
          model.cards.map((card) => channelCard(card, context)),
        ),
        model.onlyOne !== null && h('p', { class: 'hint only-one-channel' }, model.onlyOne),
        model.more !== null &&
          h('button', { type: 'button', class: 'show-more', on: { click: more } }, model.more),
      ]
  }
}

/** "New channel": opens the form to start one, where channels are on. */
const newChannelButton = (context: ViewContext): HTMLElement | null =>
  !featureOn('channels', context.state.serverInfo.get())
    ? null
    : h(
        'button',
        {
          type: 'button',
          class: 'primary new-channel',
          ...opensDialog(context, strings.createChannelTitle, (life) => createForm(context, life)),
        },
        strings.newChannel,
      )

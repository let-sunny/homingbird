import { Task as T } from '@homingbird/kernel'
import { NOTE_BODY_MAX, TOPIC_DESCRIPTION_MAX, type Topic } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import {
  TOPIC_PAGE,
  type TopicPage,
  askTopic,
  createTopic,
  launch,
  loadConversations,
  loadTopicPage,
  loadTopics,
} from '../actions.ts'
import { hrefFor } from '../routes.ts'
import { conversations, topics, topicsLoaded } from '../state.ts'
import { strings } from '../strings.ts'
import {
  isPrivate,
  isValidSlug,
  similarTopics,
  slugFrom,
  topicLabel,
  topicNamed,
  withTopic,
} from '../topics.ts'
import { agentAsk } from './agent-ask.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { emptyWithPip, field, page, topicChips, topicCounts } from './parts.ts'
import { pip } from './pip.ts'
import { joinButtons, privateMark, roomControls, rosters } from './topic-membership.ts'

export const topicsView = (life: Lifetime): HTMLElement => {
  launch(loadTopics(''))
  const query = signal('')
  const listed = signal<ListedTopics>({ query: '', topics: [], hasMore: false, cursor: null, loaded: false })
  const load = (typed: string, after: ListedTopics | null): void =>
    launch(loadTopicPage(typed, after?.cursor ?? null), (found: TopicPage) => {
      if (query.get() !== typed) return
      listed.set({
        query: typed,
        topics: [...(after?.topics ?? []), ...found.topics],
        hasMore: found.hasMore,
        cursor: found.cursor,
        loaded: true,
      })
    })
  life.add(
    topics.subscribe((known) => {
      const current = listed.get()
      if (current.topics.length <= TOPIC_PAGE) return load(query.get(), null)
      listed.set({
        ...current,
        topics: current.topics.map((shown) => known.find((topic) => topic.slug === shown.slug) ?? shown),
      })
    }),
  )
  const search = h('input', {
    type: 'search',
    name: 'q',
    placeholder: strings.topicsSearchPlaceholder,
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
    strings.topics,
    h('div', { class: 'topics-intro' }, h('p', {}, strings.topicsIntro), newTopicButton()),
    field(strings.topicsSearchLabel, search),
    region(life, [listed], () => {
      const current = listed.get()
      if (!current.loaded) return h('p', { class: 'loading' }, strings.loading)
      if (current.topics.length === 0 && current.query === '')
        return emptyWithPip(
          'searching',
          4,
          strings.noTopicsYet,
          h('div', { class: 'empty-actions' }, newTopicButton(), peopleLink()),
        )
      if (current.topics.length === 0) return emptyWithPip('searching', 4, strings.noTopics)
      return [
        h('ul', { class: 'topic-list' }, current.topics.map(topicCard)),
        current.query === '' &&
          current.topics.length === 1 &&
          !current.hasMore &&
          h('p', { class: 'hint only-one-topic' }, strings.onlyOneTopic),
        current.hasMore &&
          h(
            'button',
            { type: 'button', class: 'show-more', on: { click: () => load(current.query, current) } },
            strings.showMoreTopics,
          ),
      ]
    }),
  )
}

export const newTopicButton = (): HTMLElement =>
  h(
    'button',
    { type: 'button', class: 'primary new-topic', ...opensDialog(strings.createTopicTitle, createForm) },
    strings.newTopic,
  )

export const topicView = (life: Lifetime, slug: string): HTMLElement => {
  launch(loadTopics(''))
  const roomOf = (): string | null => {
    const topic = topicNamed(topics.get(), slug)
    const joined = topic !== null && conversations.get().some((room) => room.id === topic.conversationId)
    return joined ? topic.conversationId : null
  }
  const enterRoomIfJoined = (): void => {
    const room = roomOf()
    if (room !== null) location.replace(hrefFor({ name: 'conversation', id: room }))
  }
  life.add(topics.subscribe(enterRoomIfJoined))
  life.add(conversations.subscribe(enterRoomIfJoined))
  queueMicrotask(enterRoomIfJoined)
  return h(
    'div',
    { class: 'topic-ask-host' },
    region(life, [topics, topicsLoaded, rosters], () => {
      const topic = topicNamed(topics.get(), slug)
      if (topic === null && !topicsLoaded.get()) return h('p', { class: 'loading' }, strings.loading)
      if (topic === null)
        return emptyWithPip(
          'failed',
          4,
          strings.unknownTopic,
          h(
            'div',
            { class: 'empty-actions' },
            h('a', { class: 'button', href: hrefFor({ name: 'topics' }) }, strings.browseTopics),
            newTopicButton(),
          ),
        )
      return askPage(life, topic)
    }),
  )
}

interface ListedTopics {
  readonly query: string
  readonly topics: ReadonlyArray<Topic>
  readonly hasMore: boolean
  readonly cursor: string | null
  readonly loaded: boolean
}

const peopleLink = (): HTMLElement =>
  h('a', { class: 'button', href: hrefFor({ name: 'people' }) }, strings.askAPersonInstead)

const topicCard = (topic: Topic): HTMLElement =>
  h(
    'li',
    {
      class: `topic-card ${topic.answering ? 'is-helping' : ''} ${isPrivate(topic) ? 'is-private' : ''}`,
      data: { slug: topic.slug },
    },
    h(
      'div',
      { class: 'topic-main' },
      h(
        'h2',
        { class: 'topic-name' },
        h('a', { href: hrefFor({ name: 'topic', slug: topic.slug }) }, topicLabel(topic.slug)),
        privateMark(topic),
      ),
      h('p', { class: 'topic-description' }, topic.description),
      h(
        'p',
        { class: 'topic-meta' },
        topicCounts(topic),
        topic.answering
          ? h('span', { class: 'kind is-helping' }, strings.helpingHere)
          : topic.joined && h('span', { class: 'kind is-joined' }, strings.inRoom),
      ),
    ),
    h(
      'div',
      { class: 'topic-actions' },
      !topic.joined && !isPrivate(topic) && joinButtons(topic),
      h(
        'a',
        {
          class: `button ${topic.joined ? 'primary' : ''}`,
          href: hrefFor({ name: 'topic', slug: topic.slug }),
        },
        topic.joined || isPrivate(topic) ? strings.openRoom : strings.askTopic,
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
    maxlength: String(TOPIC_DESCRIPTION_MAX),
    placeholder: strings.topicDescriptionPlaceholder,
  })
  const visibility = visibilityChoice()
  const submit = h('button', { type: 'submit', class: 'primary' }, strings.createTopic)
  return h(
    'form',
    {
      class: 'dialog-body create-topic',
      on: {
        submit: (event) => {
          event.preventDefault()
          const wanted = slugFrom(slug.value).replace(/-+$/, '')
          if (!isValidSlug(wanted) || topicNamed(topics.get(), wanted) !== null) return
          const chosen = visibility.querySelector<HTMLInputElement>('input:checked')?.value
          launch(
            createTopic(wanted, description.value.trim(), chosen === 'private' ? 'private' : 'open'),
            (created) => {
              topics.update((all) => withTopic(all, created))
              closeDialog()
              location.hash = hrefFor({ name: 'topic', slug: created.slug })
            },
            'topic-name',
          )
        },
      },
    },
    field(strings.topicSlugLabel, slug, strings.topicSlugHint),
    region(
      life,
      [typed, topics],
      () => {
        const similar = similarTopics(topics.get(), typed.get())
        const exact = topicNamed(topics.get(), typed.get().replace(/-+$/, ''))
        submit.disabled = exact !== null
        if (exact !== null)
          return h(
            'p',
            { class: 'topic-exists', role: 'status' },
            pip('blocked', 2),
            h('span', {}, strings.topicExists({ topic: topicLabel(exact.slug) })),
            h(
              'a',
              { href: hrefFor({ name: 'topic', slug: exact.slug }), on: { click: closeDialog } },
              strings.openRoom,
            ),
          )
        return (
          similar.length > 0 &&
          h(
            'div',
            { class: 'topic-similar' },
            h('span', {}, strings.similarTopics),
            topicChips(similar.map((topic) => topic.slug)),
          )
        )
      },
      { class: 'topic-check' },
    ),
    field(strings.topicDescriptionLabel, description),
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
    h('legend', {}, strings.topicVisibility),
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

const askPage = (life: Lifetime, topic: Topic): Child => {
  const text = h('textarea', {
    name: 'body',
    rows: '4',
    required: true,
    maxlength: String(NOTE_BODY_MAX),
    placeholder: strings.askTopicPlaceholder,
    'aria-label': strings.askTopicPlaceholder,
  })
  const enterRoom = (conversationId: string): void =>
    launch(T.asUnit(loadConversations), () => {
      location.hash = hrefFor({ name: 'conversation', id: conversationId })
    })
  const mayAsk = topic.joined || !isPrivate(topic)
  return page(
    mayAsk ? strings.askTopicTitle({ topic: topicLabel(topic.slug) }) : topicLabel(topic.slug),
    privateMark(topic),
    h('p', { class: 'topic-description' }, topic.description),
    h('p', { class: 'topic-meta' }, topicCounts(topic)),
    !topic.joined && !isPrivate(topic) && joinButtons(topic),
    topic.managing && roomControls(topic),
    mayAsk &&
      h(
        'p',
        {},
        topic.helperCount === 0
          ? strings.askTopicNobodyAnswers
          : strings.askTopicIntro({ count: topic.helperCount }),
      ),
    mayAsk &&
      h(
        'form',
        {
          class: 'form ask-topic',
          on: {
            submit: (event) => {
              event.preventDefault()
              const body = text.value.trim()
              if (body !== '') launch(askTopic(topic.slug, body), enterRoom)
            },
          },
        },
        text,
        h('button', { type: 'submit', class: 'primary' }, strings.send),
        agentAsk(
          life,
          () => ({ topic: topic.slug }),
          (request) => enterRoom(request.conversationId),
        ),
      ),
  )
}

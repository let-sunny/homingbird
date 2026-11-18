import { Task as T } from '@homingbird/kernel'
import { NOTE_BODY_MAX, TOPIC_DESCRIPTION_MAX, type Topic } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { askTopic, createTopic, launch, loadConversations, loadTopics } from '../actions.ts'
import { hrefFor } from '../routes.ts'
import { conversations, topics } from '../state.ts'
import { strings } from '../strings.ts'
import {
  answeringFirst,
  isPrivate,
  isValidSlug,
  similarTopics,
  slugFrom,
  topicLabel,
  topicNamed,
} from '../topics.ts'
import { agentAsk } from './agent-ask.ts'
import { button, emptyWithPip, field, page, topicChips } from './parts.ts'
import { pip } from './pip.ts'
import { joinButtons, privateMark, roomControls } from './topic-membership.ts'

export const topicsView = (life: Lifetime): HTMLElement => {
  launch(loadTopics(''))
  const query = signal('')
  const found = signal<ReadonlyArray<Topic> | null>(null)
  const search = h('input', {
    type: 'search',
    name: 'q',
    placeholder: strings.topicsSearchPlaceholder,
    on: {
      input: () => {
        const typed = search.value.trim()
        query.set(typed)
        if (typed === '') return found.set(null)
        launch(loadTopics(typed), (matching) => {
          if (query.get() === typed) found.set(matching)
        })
      },
    },
  })
  return page(
    strings.topics,
    h('p', {}, strings.topicsIntro),
    field(strings.topicsSearchLabel, search),
    region(life, [topics, found], () => {
      const listed = found.get() ?? topics.get()
      return listed.length === 0
        ? emptyWithPip('searching', 4, strings.noTopics)
        : h('ul', { class: 'topic-list' }, [...listed].sort(answeringFirst).map(topicCard))
    }),
    createForm(life),
  )
}

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
    region(life, [topics], () => {
      const topic = topicNamed(topics.get(), slug)
      if (topic === null && topics.get().length === 0) return h('p', { class: 'loading' }, strings.loading)
      if (topic === null)
        return emptyWithPip(
          'failed',
          4,
          strings.unknownTopic,
          h('a', { class: 'button', href: hrefFor({ name: 'topics' }) }, strings.browseTopics),
        )
      return askPage(life, topic)
    }),
  )
}

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
        h('span', {}, strings.memberCount({ count: topic.memberCount })),
        h('span', {}, strings.helpers({ count: topic.helperCount })),
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
    list: SLUG_LIST_ID,
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
      class: 'form create-topic',
      on: {
        submit: (event) => {
          event.preventDefault()
          const wanted = slugFrom(slug.value).replace(/-+$/, '')
          if (!isValidSlug(wanted) || topicNamed(topics.get(), wanted) !== null) return
          const chosen = visibility.querySelector<HTMLInputElement>('input:checked')?.value
          launch(
            createTopic(wanted, description.value.trim(), chosen === 'private' ? 'private' : 'open'),
            (created) => {
              location.hash = hrefFor({ name: 'topic', slug: created.slug })
            },
          )
        },
      },
    },
    h('h2', {}, strings.createTopicTitle),
    region(
      life,
      [topics],
      () =>
        h(
          'datalist',
          { id: SLUG_LIST_ID },
          topics.get().map((topic) => h('option', { value: topic.slug }, topic.description)),
        ),
      { class: 'datalist-host' },
    ),
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
            h('a', { href: hrefFor({ name: 'topic', slug: exact.slug }) }, strings.openRoom),
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
    submit,
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
    h(
      'p',
      { class: 'topic-meta' },
      h('span', {}, strings.memberCount({ count: topic.memberCount })),
      h('span', {}, strings.helpers({ count: topic.helperCount })),
    ),
    !topic.joined && !isPrivate(topic) && joinButtons(topic),
    topic.managing && roomControls(topic),
    mayAsk && h('p', {}, strings.askTopicIntro({ count: topic.helperCount })),
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

const SLUG_LIST_ID = 'topic-slugs'

import {
  type ApiError,
  type ConversationId,
  type Note,
  TOPIC_DESCRIPTION_MAX,
  type Topic,
} from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { type Action, createTopicThen, launch, moveQuestion, readdressDraft } from '../actions.ts'
import { refusalText } from '../refusals.ts'
import { hrefFor } from '../routes.ts'
import { notice, topics } from '../state.ts'
import { strings } from '../strings.ts'
import { excerpt } from '../thread.ts'
import {
  destinationsFrom,
  isPrivate,
  isValidSlug,
  slugFrom,
  topicLabel,
  topicNamed,
  topicOfRoom,
} from '../topics.ts'
import { closeDialog, closesDialog } from './dialog.ts'
import { field, topicCounts } from './parts.ts'

export const moveForm = (life: Lifetime, note: Note, conversationId: ConversationId): Child => {
  const here = topicOfRoom(topics.get(), conversationId)
  return pickerForm(life, {
    intro: strings.moveIntro,
    quoted: note.body,
    here,
    movingFrom: here,
    submitLabel: strings.move,
    step: (slug) => moveQuestion(note, slug),
    attempt: 'move',
    after: (slug) => announceMove(slug),
  })
}

export const readdressForm = (life: Lifetime, draft: Note, currentSlug: string): Child =>
  pickerForm(life, {
    intro: strings.changeTopicLabel,
    quoted: draft.body,
    here: topicNamed(topics.get(), currentSlug),
    movingFrom: null,
    submitLabel: strings.changeTopic,
    step: (slug) => readdressDraft(draft, slug),
    attempt: 'move',
    after: () => {},
  })

interface Picker {
  readonly intro: string
  readonly quoted: string
  readonly here: Topic | null
  readonly movingFrom: Topic | null
  readonly submitLabel: string
  readonly step: (slug: string) => Action
  readonly attempt: 'move'
  readonly after: (slug: string) => void
}

const NEW_TOPIC = ''

const pickerForm = (life: Lifetime, picker: Picker): HTMLElement => {
  const choices = destinationsFrom(topics.get(), picker.here, picker.movingFrom)
  const mayCreate = picker.movingFrom === null || !isPrivate(picker.movingFrom)
  const chosen = signal<string>(choices[0]?.slug ?? NEW_TOPIC)
  const slug = h('input', {
    name: 'slug',
    maxlength: '40',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'billing',
    on: {
      input: () => {
        const normalized = slugFrom(slug.value)
        if (normalized !== slug.value) slug.value = normalized
      },
    },
  })
  const description = h('input', {
    name: 'description',
    maxlength: String(TOPIC_DESCRIPTION_MAX),
    placeholder: strings.topicDescriptionPlaceholder,
  })
  const option = (value: string, label: Child, details: Child): HTMLElement =>
    h(
      'label',
      { class: 'topic-option' },
      h('input', {
        type: 'radio',
        name: 'destination',
        value,
        checked: chosen.get() === value,
        on: { change: () => chosen.set(value) },
      }),
      h('span', { class: 'topic-option-text' }, h('strong', {}, label), details),
    )
  return h(
    'form',
    {
      class: 'dialog-body topic-picker',
      on: {
        submit: (event) => {
          event.preventDefault()
          const target = chosen.get()
          if (target !== NEW_TOPIC)
            return launch(picker.step(target), () => finish(picker, target), picker.attempt)
          const wanted = slugFrom(slug.value).replace(/-+$/, '')
          if (!isValidSlug(wanted) || description.value.trim() === '') return slug.reportValidity()
          launch(
            createTopicThen({ slug: wanted, description: description.value.trim() }, picker.step),
            (outcome) => afterCreating(picker, outcome),
            'topic-name',
          )
        },
      },
    },
    h('p', {}, picker.intro),
    h('blockquote', { class: 'quote' }, excerpt(picker.quoted, 140)),
    h(
      'fieldset',
      { class: 'topic-options' },
      h('legend', {}, strings.topicSelectLabel),
      choices.length === 0 &&
        h('p', { class: 'hint' }, mayCreate ? strings.noOtherTopic : strings.noOtherPrivateTopic),
      choices.map((topic) =>
        option(
          topic.slug,
          topicLabel(topic.slug),
          h('span', { class: 'topic-option-meta' }, topicCounts(topic)),
        ),
      ),
      mayCreate && option(NEW_TOPIC, strings.newTopicInline, h('small', {}, strings.newTopicInlineHint)),
    ),
    mayCreate &&
      region(
        life,
        [chosen],
        () =>
          chosen.get() === NEW_TOPIC && [
            field(strings.topicSlugLabel, slug, strings.topicSlugHint),
            field(strings.topicDescriptionLabel, description),
          ],
        { class: 'new-topic-fields' },
      ),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      h('button', { type: 'submit', class: 'primary' }, picker.submitLabel),
    ),
  )
}

const finish = (picker: Picker, slug: string): void => {
  closeDialog()
  picker.after(slug)
}

const afterCreating = (
  picker: Picker,
  outcome: { readonly created: Topic; readonly failure: ApiError | null },
): void => {
  closeDialog()
  if (outcome.failure === null) {
    picker.after(outcome.created.slug)
    return
  }
  notice.set({
    kind: 'error',
    text: strings.createdButNotMoved({
      topic: topicLabel(outcome.created.slug),
      reason: refusalText(outcome.failure, picker.attempt),
    }),
    link: { href: hrefFor({ name: 'topic', slug: outcome.created.slug }), label: strings.openRoom },
  })
}

const announceMove = (slug: string): void => {
  const topic = topicNamed(topics.get(), slug)
  notice.set({
    kind: 'info',
    text: strings.questionMoved({ topic: topicLabel(slug) }),
    ...(topic !== null && {
      link: { href: hrefFor({ name: 'conversation', id: topic.conversationId }), label: strings.openRoom },
    }),
  })
}

import {
  type ApiError,
  CHANNEL_DESCRIPTION_MAX,
  type Channel,
  type ConversationId,
  type Note,
} from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { type Action, createChannelThen, launch, moveQuestion, readdressDraft } from '../actions.ts'
import {
  channelLabel,
  channelNamed,
  channelOfRoom,
  destinationsFrom,
  isPrivate,
  isValidSlug,
  slugFrom,
} from '../channels.ts'
import { refusalText } from '../refusals.ts'
import { hrefFor } from '../routes.ts'
import { channels, notice } from '../state.ts'
import { strings } from '../strings.ts'
import { excerpt } from '../thread.ts'
import { closeDialog, closesDialog } from './dialog.ts'
import { channelCounts, field } from './parts.ts'

export const moveForm = (life: Lifetime, note: Note, conversationId: ConversationId): Child => {
  const here = channelOfRoom(channels.get(), conversationId)
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
    intro: strings.changeChannelLabel,
    quoted: draft.body,
    here: channelNamed(channels.get(), currentSlug),
    movingFrom: null,
    submitLabel: strings.changeChannel,
    step: (slug) => readdressDraft(draft, slug),
    attempt: 'move',
    after: () => {},
  })

interface Picker {
  readonly intro: string
  readonly quoted: string
  readonly here: Channel | null
  readonly movingFrom: Channel | null
  readonly submitLabel: string
  readonly step: (slug: string) => Action
  readonly attempt: 'move'
  readonly after: (slug: string) => void
}

const NEW_CHANNEL = ''

const pickerForm = (life: Lifetime, picker: Picker): HTMLElement => {
  const choices = destinationsFrom(channels.get(), picker.here, picker.movingFrom)
  const mayCreate = picker.movingFrom === null || !isPrivate(picker.movingFrom)
  const chosen = signal<string>(choices[0]?.slug ?? NEW_CHANNEL)
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
    maxlength: String(CHANNEL_DESCRIPTION_MAX),
    placeholder: strings.channelDescriptionPlaceholder,
  })
  const option = (value: string, label: Child, details: Child): HTMLElement =>
    h(
      'label',
      { class: 'channel-option' },
      h('input', {
        type: 'radio',
        name: 'destination',
        value,
        checked: chosen.get() === value,
        on: { change: () => chosen.set(value) },
      }),
      h('span', { class: 'channel-option-text' }, h('strong', {}, label), details),
    )
  return h(
    'form',
    {
      class: 'dialog-body channel-picker',
      on: {
        submit: (event) => {
          event.preventDefault()
          const target = chosen.get()
          if (target !== NEW_CHANNEL)
            return launch(picker.step(target), () => finish(picker, target), picker.attempt)
          const wanted = slugFrom(slug.value).replace(/-+$/, '')
          if (!isValidSlug(wanted) || description.value.trim() === '') return slug.reportValidity()
          launch(
            createChannelThen({ slug: wanted, description: description.value.trim() }, picker.step),
            (outcome) => afterCreating(picker, outcome),
            'channel-name',
          )
        },
      },
    },
    h('p', {}, picker.intro),
    h('blockquote', { class: 'quote' }, excerpt(picker.quoted, 140)),
    h(
      'fieldset',
      { class: 'channel-options' },
      h('legend', {}, strings.channelSelectLabel),
      choices.length === 0 &&
        h('p', { class: 'hint' }, mayCreate ? strings.noOtherChannel : strings.noOtherPrivateChannel),
      choices.map((channel) =>
        option(
          channel.slug,
          channelLabel(channel.slug),
          h('span', { class: 'channel-option-meta' }, channelCounts(channel)),
        ),
      ),
      mayCreate &&
        option(NEW_CHANNEL, strings.newChannelInline, h('small', {}, strings.newChannelInlineHint)),
    ),
    mayCreate &&
      region(
        life,
        [chosen],
        () =>
          chosen.get() === NEW_CHANNEL && [
            field(strings.channelSlugLabel, slug, strings.channelSlugHint),
            field(strings.channelDescriptionLabel, description),
          ],
        { class: 'new-channel-fields' },
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
  outcome: { readonly created: Channel; readonly failure: ApiError | null },
): void => {
  closeDialog()
  if (outcome.failure === null) {
    picker.after(outcome.created.slug)
    return
  }
  notice.set({
    kind: 'error',
    text: strings.createdButNotMoved({
      channel: channelLabel(outcome.created.slug),
      reason: refusalText(outcome.failure, picker.attempt),
    }),
    link: { href: hrefFor({ name: 'channel', slug: outcome.created.slug }), label: strings.openRoom },
  })
}

const announceMove = (slug: string): void => {
  const channel = channelNamed(channels.get(), slug)
  notice.set({
    kind: 'info',
    text: strings.questionMoved({ channel: channelLabel(slug) }),
    ...(channel !== null && {
      link: { href: hrefFor({ name: 'conversation', id: channel.conversationId }), label: strings.openRoom },
    }),
  })
}

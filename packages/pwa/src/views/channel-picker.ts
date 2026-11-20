import {
  type ApiError,
  type AsRead,
  CHANNEL_DESCRIPTION_MAX,
  type ConversationId,
} from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import type { Then } from '../app.ts'
import { channelLabel, channelNamed, channelOfRoom, slugFrom } from '../channels.ts'
import { featureOn } from '../features.ts'
import { NEW_CHANNEL, newChannelFrom, pickerModel } from '../models/channel-picker.ts'
import { refusalText } from '../refusals.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog } from './dialog.ts'
import { channelCounts, field } from './parts.ts'

/** Moving a channel question to another channel, an existing one or one made on the way. */
export const moveForm = (
  context: ViewContext,
  life: Lifetime,
  note: AsRead.Note,
  conversationId: ConversationId,
): Child => {
  const here = channelOfRoom(context.state.channels.get(), conversationId)
  return pickerForm(context, life, {
    intro: strings.moveIntro,
    quoted: note.body,
    here,
    movingFrom: here,
    submitLabel: strings.move,
    move: (slug, then) => context.actions.moveQuestion(note, slug, then),
    createThenMove: (channel, then) => context.actions.createChannelThenMove(channel, note, then),
    after: (slug) => announceMove(context, slug),
  })
}

/** Sending a channel draft to another channel instead. */
export const readdressForm = (
  context: ViewContext,
  life: Lifetime,
  draft: AsRead.Note,
  currentSlug: string,
): Child =>
  pickerForm(context, life, {
    intro: strings.changeChannelLabel,
    quoted: draft.body,
    here: channelNamed(context.state.channels.get(), currentSlug),
    movingFrom: null,
    submitLabel: strings.changeChannel,
    move: (slug, then) => context.actions.readdressDraft(draft, slug, then),
    createThenMove: (channel, then) => context.actions.createChannelThenReaddress(channel, draft, then),
    after: () => {},
  })

interface Picker {
  readonly intro: string
  readonly quoted: string
  readonly here: AsRead.Channel | null
  readonly movingFrom: AsRead.Channel | null
  readonly submitLabel: string
  readonly move: (slug: string, then: Then<void>) => void
  readonly createThenMove: (
    channel: { readonly slug: string; readonly description: string },
    then: Then<{ readonly created: AsRead.Channel; readonly failure: ApiError | null }>,
  ) => void
  readonly after: (slug: string) => void
}

const pickerForm = (context: ViewContext, life: Lifetime, picker: Picker): HTMLElement => {
  const model = pickerModel({
    channels: context.state.channels.get(),
    here: picker.here,
    movingFrom: picker.movingFrom,
    quoted: picker.quoted,
    channelsOn: featureOn('channels', context.state.serverInfo.get()),
  })
  const chosen = signal<string>(model.first)
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
  const submit = (): void => {
    const target = chosen.get()
    if (target !== NEW_CHANNEL) {
      picker.move(target, {
        done: () => {
          closeDialog(context)
          picker.after(target)
        },
        attempt: 'move',
      })
      return
    }
    const wanted = newChannelFrom(slug.value, description.value)
    if (wanted === null) return void slug.reportValidity()
    picker.createThenMove(wanted, {
      done: (outcome) => afterCreating(context, picker, outcome),
      attempt: 'channel-name',
    })
  }
  return h(
    'form',
    {
      class: 'dialog-body channel-picker',
      on: {
        submit: (event) => {
          event.preventDefault()
          submit()
        },
      },
    },
    h('p', {}, picker.intro),
    h('blockquote', { class: 'quote' }, model.quote),
    h(
      'fieldset',
      { class: 'channel-options' },
      h('legend', {}, strings.channelSelectLabel),
      model.none !== null && h('p', { class: 'hint' }, model.none),
      model.choices.map((choice) =>
        option(
          choice.value,
          choice.label,
          h('span', { class: 'channel-option-meta' }, channelCounts(choice.channel)),
        ),
      ),
      model.mayCreate &&
        option(NEW_CHANNEL, strings.newChannelInline, h('small', {}, strings.newChannelInlineHint)),
    ),
    model.mayCreate &&
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

const afterCreating = (
  context: ViewContext,
  picker: Picker,
  outcome: { readonly created: AsRead.Channel; readonly failure: ApiError | null },
): void => {
  closeDialog(context)
  if (outcome.failure === null) {
    picker.after(outcome.created.slug)
    return
  }
  context.state.notice.set({
    kind: 'error',
    text: strings.createdButNotMoved({
      channel: channelLabel(outcome.created.slug),
      reason: refusalText(outcome.failure, 'move'),
    }),
    link: { href: hrefFor({ name: 'channel', slug: outcome.created.slug }), label: strings.openRoom },
  })
}

const announceMove = (context: ViewContext, slug: string): void => {
  const channel = channelNamed(context.state.channels.get(), slug)
  context.state.notice.set({
    kind: 'info',
    text: strings.questionMoved({ channel: channelLabel(slug) }),
    ...(channel !== null && {
      link: {
        href: hrefFor({ name: 'conversation', id: channel.conversationId, draft: null }),
        label: strings.openRoom,
      },
    }),
  })
}

import type { ConversationId, MemberId } from '@homingbird/protocol'
import type { ReadableSignal, Signal } from '@homingbird/ui'
import { type Lifetime, h, onAnyChange, region, signal, slice } from '@homingbird/ui'
import {
  type ComposerTagsModel,
  type Mention,
  TAG_PICKER_ID,
  composerTagsModel,
  mentionAt,
  withMentionChosen,
} from '../models/composer-tags.ts'
import { type ComposerModel, bodyToSend } from '../models/composer.ts'
import { pickerKey, withChosen } from '../models/people-picker.ts'
import type { ThreadInput } from '../models/thread-room.ts'
import { strings } from '../strings.ts'
import { replyTargetIn } from '../tasks/notes.ts'
import { agentAsk } from './agent-ask.ts'
import { answeredBefore } from './answered-before.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { hinted } from './hint.ts'
import { button, slackReplyLines } from './parts.ts'
import { IME_KEY_CODE, renderChips, renderOptions } from './people-picker.ts'

/**
 * Where the person writes a note, or why they cannot in an archived room. Enter sends where there is a
 * keyboard; on a touch screen the return key starts a new line and Send sends, as in other messengers.
 * Escape stops replying to a note. Once a note is sent, `sent` brings the thread back to the bottom.
 * In a group message, `room` gives what tagging people with @ reads.
 */
export const composer = (
  context: ViewContext,
  life: Lifetime,
  id: ConversationId,
  model: () => ComposerModel,
  sources: ReadonlyArray<ReadableSignal<unknown>>,
  sent: () => void = () => {},
  room: (() => ThreadInput) | null = null,
): HTMLElement => {
  const shown = model()
  if (shown.kind === 'archived') return archivedComposer(shown.notice)
  const { actions, state } = context
  const enterSends = !context.page.isCoarsePointer()
  const text = h('textarea', {
    name: 'body',
    rows: '1',
    required: true,
    placeholder: strings.composerPlaceholder,
    'aria-label': strings.composerLabel,
    maxlength: '16000',
    enterkeyhint: enterSends ? 'send' : 'enter',
  })
  text.value = state.composerTexts.get().get(id) ?? ''
  const typed = signal(text.value)
  text.addEventListener('input', () => {
    typed.set(text.value)
    actions.keepComposerText(id, text.value)
  })
  const tags = room === null ? null : tagTypeahead(context, life, id, text, typed, room)
  const send = (): void => {
    const body = bodyToSend(text.value)
    if (body === null) return
    text.value = ''
    typed.set('')
    tags?.close()
    actions.keepComposerText(id, '')
    actions.sendNote(id, body, { attempt: 'draft' })
    sendButton.classList.add('is-flying')
    sent()
    text.focus()
  }
  text.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    if (tags?.handled(event)) return
    if (event.key === 'Escape' && replyTargetIn(state, id) !== null) {
      event.preventDefault()
      actions.chooseReplyTarget(id, null)
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || !enterSends) return
    event.preventDefault()
    send()
  })
  const sendButton = h('button', { type: 'submit', class: 'primary send' }, strings.send)
  keepsFocusIn(context, sendButton, text)
  sendButton.addEventListener('animationend', () => sendButton.classList.remove('is-flying'))
  const ask =
    shown.asksAgent &&
    agentAsk(context, life, () => {
      const inReplyTo = replyTargetIn(state, id)
      return inReplyTo === null ? { conversationId: id } : { inReplyTo }
    })
  const askButton = ask === false ? null : askToggle(ask)
  const reflectReachability = (): void => {
    const current = model()
    const blocked = current.kind === 'open' && current.blocked !== null
    for (const control of [text, sendButton]) {
      control.disabled = blocked
      if (blocked) control.setAttribute('aria-describedby', BLOCKED_REASON_ID)
      else control.removeAttribute('aria-describedby')
    }
    if (askButton !== null)
      reflectAskReason(askButton, current.kind === 'open' ? current.askAgentReason : null)
  }
  reflectReachability()
  const status = slice(sources, model)
  life.add(state.directory.subscribe(reflectReachability))
  life.add(state.conversations.subscribe(reflectReachability))
  const focusWhenAsked = (): void => {
    if (state.composerFocus.get() !== id) return
    context.page.nextFrame(() => {
      if (!text.isConnected || state.composerFocus.get() !== id) return
      state.composerFocus.set(null)
      text.focus()
    })
  }
  focusWhenAsked()
  life.add(state.composerFocus.subscribe(focusWhenAsked))
  return h(
    'form',
    {
      class: 'composer',
      on: {
        submit: (event) => {
          event.preventDefault()
          send()
        },
      },
    },
    region(life, [status], () => renderComposerStatus(context, id, status.get())),
    tags?.element,
    shown.lookUpEarlierAnswers &&
      answeredBefore(context, life, id, {
        typed,
        isReplying: () => replyTargetIn(context.state, id) !== null,
        clear: () => {
          text.value = ''
          typed.set('')
          actions.keepComposerText(id, '')
        },
      }),
    h('div', { class: 'composer-row' }, text, askButton?.toggle, sendButton),
    askButton?.reason,
    h('small', { class: 'composer-hint' }, strings.composerHint),
    ask,
  )
}

/**
 * Tagging people in a group message: typing @ and part of a name lists the people in the room who
 * match, as the people picker does; Enter, Tab or a click tags the one marked and writes their name
 * into the text, and the arrow keys move through the list. Above the field, the people tagged and one
 * line saying whose agents will draft a reply.
 */
const tagTypeahead = (
  context: ViewContext,
  life: Lifetime,
  id: ConversationId,
  text: HTMLTextAreaElement,
  typed: Signal<string>,
  room: () => ThreadInput,
): TagTypeahead => {
  const { actions, state } = context
  const mention = signal<Mention | null>(null)
  const active = signal<MemberId | null>(null)
  const chosen = (): ReadonlyArray<MemberId> => state.composerTags.get().get(id) ?? []
  const model = (): ComposerTagsModel | null =>
    composerTagsModel({ ...room(), chosen: chosen(), mention: mention.get(), active: active.get() })
  const lookForMention = (): void => {
    mention.set(mentionAt(text.value, text.selectionStart ?? text.value.length))
    active.set(null)
  }
  text.addEventListener('input', lookForMention)
  text.addEventListener('blur', () => mention.set(null))
  const choose = (memberId: MemberId): void => {
    const typing = mention.get()
    const name = model()?.picker.options.find((option) => option.memberId === memberId)?.name
    if (typing !== null && name !== undefined) {
      const written = withMentionChosen(text.value, typing, name)
      text.value = written.text
      text.setSelectionRange?.(written.caret, written.caret)
      typed.set(text.value)
      actions.keepComposerText(id, text.value)
    }
    actions.keepComposerTags(id, withChosen(chosen(), memberId, null))
    mention.set(null)
    text.focus()
  }
  const remove = (memberId: MemberId): void => {
    actions.keepComposerTags(
      id,
      chosen().filter((one) => one !== memberId),
    )
    text.focus()
  }
  const handled = (event: KeyboardEvent): boolean => {
    const shown = model()
    if (shown === null || !shown.picker.expanded || event.keyCode === IME_KEY_CODE) return false
    const move = pickerKey(event.key === 'Tab' ? 'Enter' : event.key, false, ' ', shown.picker)
    if (move.kind === 'none' || move.kind === 'remove') return false
    event.preventDefault()
    if (move.kind === 'move') active.set(move.memberId)
    else if (move.kind === 'choose') choose(move.memberId)
    else mention.set(null)
    return true
  }
  const sources = [
    state.composerTags,
    state.replyTargets,
    state.conversations,
    state.directory,
    state.members,
  ]
  const reflect = (): void => {
    const picker = model()?.picker ?? null
    if (picker === null) {
      for (const name of ['aria-autocomplete', 'aria-controls', 'aria-activedescendant'])
        text.removeAttribute(name)
      return
    }
    text.setAttribute('aria-autocomplete', 'list')
    text.setAttribute('aria-controls', TAG_OPTIONS_ID)
    if (!picker.expanded || picker.activeId === null) text.removeAttribute('aria-activedescendant')
    else text.setAttribute('aria-activedescendant', picker.activeId)
  }
  reflect()
  life.add(onAnyChange([mention, active, ...sources], reflect))
  const element = region(
    life,
    [mention, active, ...sources],
    () => {
      const shown = model()
      if (shown === null) return null
      return [
        renderOptions(shown.picker, TAG_OPTIONS_ID, choose),
        renderChips(shown.picker, remove),
        h(
          'p',
          { class: 'composer-asks', role: 'note' },
          ...hinted(context, 'tagging', shown.hint, h('span', {}, shown.notice)),
        ),
      ]
    },
    { class: 'composer-tags' },
  )
  return { element, handled, close: () => mention.set(null) }
}

interface TagTypeahead {
  readonly element: HTMLElement
  /** Whether a key went to the list of people to tag, which is then the key's only effect. */
  readonly handled: (event: KeyboardEvent) => boolean
  /** Closes the list, as when the note is sent. */
  readonly close: () => void
}

const TAG_OPTIONS_ID = `${TAG_PICKER_ID}-options`

/**
 * “Let my agent write it”, beside Send: it opens the request below, whose own button asks, or says
 * why the agent cannot be asked. The panel's own line to open it is then left out.
 */
export const askToggle = (ask: HTMLDetailsElement): AskToggle => {
  ask.id = ASK_PANEL_ID
  const summary = ask.querySelector('summary')
  if (summary !== null) summary.hidden = true
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'ask-agent-toggle',
      'aria-controls': ASK_PANEL_ID,
      'aria-expanded': 'false',
      title: strings.letAgentWriteHint,
      on: {
        click: () => {
          ask.open = !ask.open
          if (ask.open) ask.querySelector<HTMLElement>('input')?.focus()
        },
      },
    },
    strings.letAgentWrite,
  )
  ask.addEventListener('toggle', () => toggle.setAttribute('aria-expanded', String(ask.open)))
  return { toggle, reason: h('span', { id: ASK_REASON_ID, class: 'visually-hidden' }) }
}

export const reflectAskReason = (parts: AskToggle, reason: string | null): void => {
  parts.toggle.disabled = reason !== null
  parts.reason.textContent = reason ?? ''
  if (reason === null) {
    parts.toggle.title = strings.letAgentWriteHint
    parts.toggle.removeAttribute('aria-describedby')
  } else {
    parts.toggle.title = reason
    parts.toggle.setAttribute('aria-describedby', ASK_REASON_ID)
  }
}

export interface AskToggle {
  readonly toggle: HTMLButtonElement
  readonly reason: HTMLElement
}

/** A press on the button does not take the focus from the field, so a phone's keyboard stays open. */
const keepsFocusIn = (context: ViewContext, control: HTMLElement, field: HTMLElement): void =>
  control.addEventListener('pointerdown', (event) => {
    if (context.document.focused() === field) event.preventDefault()
  })

const renderComposerStatus = (context: ViewContext, id: ConversationId, model: ComposerModel) => {
  if (model.kind === 'archived') return null
  return [
    model.sending !== null &&
      h(
        'p',
        { class: 'sending', role: 'status' },
        renderAvatar(context, model.sending.avatar),
        model.sending.text,
      ),
    model.asked.map((asked) =>
      h(
        'p',
        { class: 'asked-chip', role: 'status', data: { requestId: asked.request.id } },
        renderAvatar(context, asked.avatar),
        h('span', {}, asked.text),
        hinted(
          context,
          'withdrawRequest',
          strings.hints.withdrawRequest,
          button(
            strings.withdraw,
            () => context.actions.withdrawRequest(asked.request, { attempt: 'request' }),
            {
              class: 'link',
            },
          ),
        ),
      ),
    ),
    model.noAgent !== null &&
      h(
        'p',
        { class: 'no-agent', role: 'note' },
        h('span', {}, model.noAgent.text),
        h('a', { href: model.noAgent.href }, model.noAgent.link),
      ),
    model.theirAgent !== null && h('p', { class: 'no-agent', role: 'note' }, model.theirAgent),
    model.answers !== null &&
      h(
        'p',
        { class: model.answers.warning ? 'channel-answers no-agent' : 'channel-answers', role: 'note' },
        model.answers.text,
      ),
    model.replyingTo !== null &&
      h(
        'p',
        { class: 'reply-chip' },
        h('span', {}, model.replyingTo),
        hinted(
          context,
          'replyTarget',
          strings.hints.replyTarget,
          button('✕', () => context.actions.chooseReplyTarget(id, null), {
            class: 'icon',
            'aria-label': strings.stopReplying,
          }),
        ),
      ),
    slackReplyLines(model.slack),
    model.blocked !== null &&
      h('p', { class: 'composer-blocked', id: BLOCKED_REASON_ID, role: 'note' }, model.blocked),
  ]
}

const ARCHIVED_REASON_ID = 'archived-reason'
const BLOCKED_REASON_ID = 'composer-blocked-reason'
const ASK_PANEL_ID = 'composer-ask-agent'
const ASK_REASON_ID = 'composer-ask-agent-reason'

const archivedComposer = (notice: string): HTMLElement =>
  h(
    'form',
    { class: 'composer is-disabled', 'aria-disabled': 'true' },
    h('p', { class: 'archived-notice', id: ARCHIVED_REASON_ID, role: 'note' }, notice),
    h(
      'div',
      { class: 'composer-row' },
      h('textarea', {
        name: 'body',
        rows: '1',
        disabled: true,
        'aria-label': strings.composerLabel,
        'aria-describedby': ARCHIVED_REASON_ID,
      }),
      h(
        'button',
        { type: 'submit', class: 'primary send', disabled: true, 'aria-describedby': ARCHIVED_REASON_ID },
        strings.send,
      ),
    ),
  )

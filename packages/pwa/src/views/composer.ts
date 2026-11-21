import type { ConversationId } from '@homingbird/protocol'
import type { ReadableSignal } from '@homingbird/ui'
import { type Lifetime, h, region, signal, slice } from '@homingbird/ui'
import { type ComposerModel, bodyToSend } from '../models/composer.ts'
import { strings } from '../strings.ts'
import { replyTargetIn } from '../tasks/notes.ts'
import { agentAsk } from './agent-ask.ts'
import { answeredBefore } from './answered-before.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { button } from './parts.ts'

/** Where the person writes a note, or why they cannot in an archived room. */
export const composer = (
  context: ViewContext,
  life: Lifetime,
  id: ConversationId,
  model: () => ComposerModel,
  sources: ReadonlyArray<ReadableSignal<unknown>>,
): HTMLElement => {
  const shown = model()
  if (shown.kind === 'archived') return archivedComposer(shown.notice)
  const { actions, state } = context
  const text = h('textarea', {
    name: 'body',
    rows: '1',
    required: true,
    placeholder: strings.composerPlaceholder,
    'aria-label': strings.composerLabel,
    maxlength: '16000',
  })
  text.value = state.composerTexts.get().get(id) ?? ''
  const typed = signal(text.value)
  text.addEventListener('input', () => {
    typed.set(text.value)
    actions.keepComposerText(id, text.value)
  })
  const send = (): void => {
    const body = bodyToSend(text.value)
    if (body === null) return
    text.value = ''
    typed.set('')
    actions.keepComposerText(id, '')
    actions.sendNote(id, body, { attempt: 'draft' })
    text.focus()
  }
  text.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    send()
  })
  const sendButton = h('button', { type: 'submit', class: 'primary send' }, strings.send)
  keepsFocusIn(context, sendButton, text)
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

/** The composer's “Ask my agent”, beside Send: it opens the request below, or says why it cannot. */
const askToggle = (ask: HTMLDetailsElement): AskToggle => {
  ask.id = ASK_PANEL_ID
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'ask-agent-toggle',
      'aria-controls': ASK_PANEL_ID,
      'aria-expanded': 'false',
      on: {
        click: () => {
          ask.open = !ask.open
          if (ask.open) ask.querySelector<HTMLElement>('input')?.focus()
        },
      },
    },
    strings.askAgent,
  )
  ask.addEventListener('toggle', () => toggle.setAttribute('aria-expanded', String(ask.open)))
  return { toggle, reason: h('span', { id: ASK_REASON_ID, class: 'visually-hidden' }) }
}

const reflectAskReason = (parts: AskToggle, reason: string | null): void => {
  parts.toggle.disabled = reason !== null
  parts.reason.textContent = reason ?? ''
  if (reason === null) {
    parts.toggle.removeAttribute('title')
    parts.toggle.removeAttribute('aria-describedby')
  } else {
    parts.toggle.title = reason
    parts.toggle.setAttribute('aria-describedby', ASK_REASON_ID)
  }
}

interface AskToggle {
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
        button(
          strings.withdraw,
          () => context.actions.withdrawRequest(asked.request, { attempt: 'request' }),
          {
            class: 'link',
          },
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
        button('✕', () => context.actions.chooseReplyTarget(id, null), {
          class: 'icon',
          'aria-label': strings.stopReplying,
        }),
      ),
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

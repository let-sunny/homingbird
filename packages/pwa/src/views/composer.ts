import type { ConversationId } from '@homingbird/protocol'
import type { ReadableSignal } from '@homingbird/ui'
import { type Lifetime, h, region, slice } from '@homingbird/ui'
import { type ComposerModel, bodyToSend } from '../models/composer.ts'
import { strings } from '../strings.ts'
import { replyTargetIn } from '../tasks/notes.ts'
import { agentAsk } from './agent-ask.ts'
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
  const { actions } = context
  const text = h('textarea', {
    name: 'body',
    rows: '1',
    required: true,
    placeholder: strings.composerPlaceholder,
    'aria-label': strings.composerLabel,
    maxlength: '16000',
  })
  const send = (): void => {
    const body = bodyToSend(text.value)
    if (body === null) return
    text.value = ''
    actions.sendNote(id, body, { attempt: 'draft' })
  }
  text.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    send()
  })
  const sendButton = h('button', { type: 'submit', class: 'primary send' }, strings.send)
  const reflectReachability = (): void => {
    const current = model()
    const blocked = current.kind === 'open' && current.blocked !== null
    for (const control of [text, sendButton]) {
      control.disabled = blocked
      if (blocked) control.setAttribute('aria-describedby', BLOCKED_REASON_ID)
      else control.removeAttribute('aria-describedby')
    }
  }
  reflectReachability()
  const status = slice(sources, model)
  life.add(context.state.directory.subscribe(reflectReachability))
  life.add(context.state.conversations.subscribe(reflectReachability))
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
    h('div', { class: 'composer-row' }, text, sendButton),
    h('small', { class: 'composer-hint' }, strings.composerHint),
    shown.asksAgent &&
      agentAsk(context, life, () => {
        const inReplyTo = replyTargetIn(context.state, id)
        return inReplyTo === null ? { conversationId: id } : { inReplyTo }
      }),
  )
}

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

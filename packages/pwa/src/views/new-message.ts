import { type AsRead, type MemberId, RECIPIENTS_MAX } from '@homingbird/protocol'
import { type Lifetime, h, onAnyChange, region, signal } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import { bodyToSend } from '../models/composer.ts'
import { type NewMessageModel, newMessageModel, recipientsOf } from '../models/new-message.ts'
import { messageCandidates } from '../models/people-picker.ts'
import { strings } from '../strings.ts'
import { agentAskPanel } from './agent-ask.ts'
import { askToggle, reflectAskReason } from './composer.ts'
import type { ViewContext } from './context.ts'
import { page } from './parts.ts'
import { peoplePicker } from './people-picker.ts'

/**
 * A note to people chosen first: "To:", the note, and who will read it. Nothing is made until the
 * note is sent or the agent is asked for it, so leaving the screen leaves nothing behind.
 */
export const newMessageView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  to: ReadonlyArray<string>,
): HTMLElement => {
  const { state, actions } = context
  actions.loadPeople()
  const chosen = signal<ReadonlyArray<MemberId>>(to as ReadonlyArray<MemberId>)
  const typed = signal('')
  const sending = signal(false)
  const candidates = () =>
    messageCandidates({
      directory: state.directory.get(),
      conversations: state.conversations.get(),
      viewerId: me.member.id,
      contactMode: me.contactMode,
    })
  const model = (): NewMessageModel =>
    newMessageModel({
      candidates: candidates(),
      chosen: chosen.get(),
      conversations: state.conversations.get(),
      viewerId: me.member.id,
      typed: typed.get(),
      sending: sending.get(),
      draftRequestsOn: featureOn('draftRequests', state.serverInfo.get()),
      myPresence: state.directory.get().find((entry) => entry.member.id === me.member.id)?.presence,
    })
  const sources = [state.directory, state.conversations, chosen, typed, sending, state.serverInfo]
  const picker = peoplePicker(life, {
    id: 'new-to',
    label: strings.newMessage.to,
    placeholder: strings.newMessage.placeholder,
    candidates,
    sources: [state.directory, state.conversations],
    chosen,
    limit: RECIPIENTS_MAX,
  })
  const recipients = (): ReadonlyArray<MemberId> =>
    recipientsOf({ candidates: candidates(), chosen: chosen.get() })
  const failed = { failed: () => sending.set(false) }
  const text = h('textarea', {
    name: 'body',
    rows: '3',
    placeholder: strings.composerPlaceholder,
    'aria-label': strings.composerLabel,
    maxlength: '16000',
    on: { input: () => typed.set(text.value) },
  })
  const send = (): void => {
    const body = bodyToSend(text.value)
    if (body === null || !model().send.enabled) return
    sending.set(true)
    actions.sendNoteAmong(recipients(), body, failed)
  }
  text.addEventListener('keydown', (event) => {
    if (event.isComposing || event.key !== 'Enter' || event.shiftKey || context.page.isCoarsePointer()) return
    event.preventDefault()
    send()
  })
  const sendButton = h(
    'button',
    { type: 'submit', class: 'primary send', 'aria-describedby': REASON_ID },
    strings.send,
  )
  const ask = agentAskPanel(context, life, (wanted) => {
    if (!model().ask?.enabled) return
    sending.set(true)
    actions.askAgentAmong(recipients(), wanted.instruction, wanted.agentId, failed)
  })
  const toggle = model().ask === null ? null : askToggle(ask)
  const reflect = (): void => {
    const shown = model()
    sendButton.disabled = !shown.send.enabled
    sendButton.textContent = shown.send.label
    if (toggle !== null) reflectAskReason(toggle, shown.ask?.reason ?? null)
  }
  reflect()
  life.add(onAnyChange(sources, reflect))
  context.page.nextFrame(() => (chosen.get().length === 0 ? picker.field : text).focus())
  return page(
    strings.newMessage.title,
    h(
      'form',
      {
        class: 'new-message',
        on: {
          submit: (event) => {
            event.preventDefault()
            send()
          },
        },
      },
      picker.element,
      region(life, sources, () => renderAudience(model()), { class: 'new-message-audience' }),
      h('div', { class: 'composer-row' }, text, toggle?.toggle, sendButton),
      toggle?.reason,
      h(
        'div',
        { id: REASON_ID, class: 'new-message-reason' },
        region(life, sources, () => model().send.reason, { class: 'new-message-reason-text' }),
      ),
      h('small', { class: 'composer-hint' }, strings.composerHint),
      ask,
    ),
  )
}

const REASON_ID = 'new-message-reason'

const renderAudience = (model: NewMessageModel): HTMLElement =>
  h(
    'p',
    { class: 'new-message-readers', role: 'status' },
    h('span', {}, model.audience),
    model.where !== null && [
      ' ',
      h('span', {}, model.where.text),
      model.where.link !== null && [' ', h('a', { href: model.where.link.href }, model.where.link.label)],
    ],
  )

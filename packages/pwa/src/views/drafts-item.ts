import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, linkedText } from '@homingbird/ui'
import {
  type DraftCard,
  type DraftsItemModel,
  type EditorInput,
  draftChangedWhileEditing,
  isUnchangedWhileEditing,
} from '../models/drafts-item.ts'
import { strings } from '../strings.ts'
import { readdressForm } from './channel-picker.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { cardOf, focusAfterDecision } from './decision-focus.ts'
import { closeDialog, closesDialog, opensDialog, submitOnModifierEnter } from './dialog.ts'
import { noteBody } from './note-body.ts'
import { button, channelCounts, sourceList } from './parts.ts'
import { renderAppliedMarkers } from './teaching.ts'

/**
 * The drafts waiting in one place of the conversation; each card reports once that the person saw it,
 * and is named by the heading and its origin.
 */
export const renderDraftsItem = (context: ViewContext, model: DraftsItemModel): HTMLElement => {
  const headingId = `pending-heading-${model.cards[0]?.draft.id ?? ''}`
  return h(
    'li',
    { class: 'pending', data: { decisionUnit: '' } },
    h(
      'div',
      { class: 'pending-head' },
      renderAvatar(context, model.avatar),
      h('strong', { id: headingId }, model.heading),
      h('span', {}, model.replyTo),
    ),
    model.choose !== null && h('p', { class: 'pending-choose' }, model.choose),
    model.archived !== null && h('p', { class: 'archived-drafts', role: 'note' }, model.archived),
    h(
      'div',
      { class: 'alternatives' },
      model.cards.map((card) => {
        const shown = draftCard(context, card, headingId)
        reportWhenSeen(context, shown, card.draft)
        return shown
      }),
    ),
  )
}

const draftCard = (context: ViewContext, card: DraftCard, headingId: string): HTMLElement => {
  const { actions } = context
  const draft = card.draft
  return h(
    'article',
    {
      class: 'draft',
      'aria-labelledby': `${headingId} draft-origin-${draft.id}`,
      data: { draftId: draft.id, decides: draft.id, tour: 'approval' },
      tabindex: '-1',
      ...(card.focused && { 'aria-current': 'true' }),
    },
    h('span', { class: card.origin.className, id: `draft-origin-${draft.id}` }, card.origin.text),
    noteBody(context, card.body),
    card.basis !== null &&
      h(
        'section',
        { class: 'draft-basis', 'aria-label': strings.draftBasisTitle },
        h('h3', {}, strings.draftBasisTitle),
        ...(card.basis.kind === 'none'
          ? [h('p', { class: 'basis-missing' }, strings.draftBasisMissing)]
          : [
              ...card.basis.lines.map((line) => h('p', {}, linkedText(line))),
              sourceList(card.basis.sources),
            ]),
      ),
    renderAppliedMarkers(card.applied, context),
    card.destination !== null &&
      h(
        'p',
        { class: 'draft-destination' },
        card.destination.kind === 'channel'
          ? [h('span', {}, card.destination.text), channelCounts(card.destination.channel)]
          : card.destination.text,
      ),
    card.careful !== null && h('p', { class: 'careful-reading', role: 'note' }, card.careful),
    card.keptEdit !== null && h('p', { class: 'kept-edit hint', role: 'note' }, card.keptEdit),
    card.actions !== null && draftActions(context, card, card.actions),
  )
}

/**
 * Send, Edit and Discard, always in that order with Send first and Discard set apart at the end; a draft
 * changed since it was read offers reading it again in Send's place. Send and Discard are held for a
 * moment before the server hears of them, so the person can undo either.
 */
const draftActions = (
  context: ViewContext,
  card: DraftCard,
  shown: NonNullable<DraftCard['actions']>,
): HTMLElement => {
  const { actions } = context
  const draft = card.draft
  const decide = (event: Event): void =>
    focusAfterDecision(context, (event.target as Element | null)?.closest('[data-decides]') ?? null, draft.id)
  const discard = button(
    strings.discard,
    (event) => {
      decide(event)
      actions.holdDiscard(draft, shown.held.discard, HELD)
    },
    { class: 'danger draft-discard' },
  )
  if (card.readAgain !== null)
    return h(
      'div',
      { class: 'draft-actions draft-changed' },
      h('p', { role: 'alert' }, card.readAgain.notice),
      button(card.readAgain.confirm, () => actions.confirmDraftRead(draft), { class: 'primary' }),
      discard,
    )
  return h(
    'div',
    { class: 'draft-actions' },
    button(
      shown.send,
      (event) => {
        decide(event)
        actions.holdSend(draft, null, shown.alternatives, shown.held.send, HELD)
      },
      { class: 'primary draft-send' },
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'draft-edit',
        ...opensDialog(context, strings.editDraftTitle, (life) =>
          draftEditor(context, life, draft, shown, cardOf(context, draft.id)),
        ),
      },
      strings.edit,
    ),
    shown.changeChannel !== null &&
      h(
        'button',
        {
          type: 'button',
          class: 'change-channel',
          ...opensDialog(context, strings.changeChannel, (life) =>
            readdressForm(context, life, draft, shown.changeChannel!),
          ),
        },
        strings.changeChannel,
      ),
    discard,
  )
}

/** A held send or discard reports a refusal as a draft's, once it reaches the server. */
const HELD = { attempt: 'draft' } as const

/**
 * Reports a draft as seen, once per page, when its card is on a screen the person can see, so the time
 * from seeing a draft to deciding can be measured. A hidden page waits until it is shown.
 */
export const reportWhenSeen = (
  context: ViewContext,
  card: HTMLElement,
  draft: Pick<AsRead.Note, 'id'>,
): void => {
  const { state, page, actions } = context
  if (state.seenDrafts.has(draft.id)) return
  let stopWaiting = (): void => {}
  const report = (): void => {
    if (state.seenDrafts.has(draft.id) || !card.isConnected || !page.isVisible()) return
    state.seenDrafts.add(draft.id)
    stopWaiting()
    actions.reportDraftSeen(draft.id)
  }
  page.nextFrame(() => {
    report()
    if (!state.seenDrafts.has(draft.id) && card.isConnected) stopWaiting = page.on('visibilitychange', report)
  })
}

/**
 * The person's own wording of a draft. Closing it any way keeps the edit on the card, as the composer
 * keeps unsent text; saving or sending the draft lets the kept edit go once the server has it.
 */
const draftEditor = (
  context: ViewContext,
  life: Lifetime,
  draft: AsRead.Note,
  offered: NonNullable<DraftCard['actions']>,
  card: Element | null,
): Child => {
  const text = h('textarea', {
    name: 'body',
    rows: '6',
    required: true,
    autofocus: true,
    'aria-label': strings.editDraftLabel,
    on: { keydown: submitOnModifierEnter },
  })
  text.value = offered.editText
  let baseline = draft
  let saved = false
  life.add(() => {
    if (!saved) context.actions.keepDraftEdit(draft.id, baseline.body, text.value)
  })
  const changed = h('div', { class: 'draft-changed', role: 'alert' })
  const save = button(strings.saveDraft, () =>
    context.actions.saveDraft(baseline, text.value, {
      done: () => {
        saved = true
        context.actions.keepDraftEdit(draft.id, text.value, text.value)
        closeDialog(context)
      },
      attempt: 'draft',
    }),
  )
  const send = h('button', { type: 'submit', class: 'primary' }, strings.sendEdited)
  const holdUntilConfirmed = (held: boolean): void => {
    save.disabled = held
    send.disabled = held
  }
  const showChange = (): void => {
    const now = draftChangedWhileEditing(editorInputOf(context), baseline)
    if (now === null) {
      closeDialog(context)
      return
    }
    const shown = [h('p', {}, now.notice), noteBody(context, now.body)]
    if (now.moved === null) {
      baseline = now.draft
      changed.replaceChildren(...shown)
      return
    }
    const confirm = button(now.moved.confirm, () => {
      baseline = now.draft
      holdUntilConfirmed(false)
      confirm.remove()
    })
    holdUntilConfirmed(true)
    const destination =
      now.moved.destination === null ? [] : [h('p', { class: 'draft-destination' }, now.moved.destination)]
    changed.replaceChildren(...shown, ...destination, confirm)
  }
  return h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          if (!isUnchangedWhileEditing(editorInputOf(context), baseline)) {
            showChange()
            return
          }
          focusAfterDecision(context, card, draft.id)
          context.actions.holdSend(baseline, text.value, offered.alternatives, offered.held.send, HELD)
          closeDialog(context)
        },
      },
    },
    changed,
    text,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      save,
      send,
    ),
  )
}

const editorInputOf = ({ state }: ViewContext): EditorInput => ({
  threads: state.threads.get(),
  conversations: state.conversations.get(),
  channels: state.channels.get(),
  members: state.members.get(),
})

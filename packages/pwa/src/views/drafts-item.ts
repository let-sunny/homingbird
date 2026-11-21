import type { AsRead } from '@homingbird/protocol'
import { type Child, h, linkedText } from '@homingbird/ui'
import {
  type DraftCard,
  type DraftsItemModel,
  type EditorInput,
  draftChangedWhileEditing,
} from '../models/drafts-item.ts'
import { strings } from '../strings.ts'
import { readdressForm } from './channel-picker.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, channelCounts } from './parts.ts'
import { renderAppliedMarkers } from './teaching.ts'

/** The drafts waiting in one place of the conversation; each card reports once that the person saw it. */
export const renderDraftsItem = (context: ViewContext, model: DraftsItemModel): HTMLElement =>
  h(
    'li',
    { class: 'pending' },
    h(
      'div',
      { class: 'pending-head' },
      renderAvatar(context, model.avatar),
      h('strong', {}, model.heading),
      h('span', {}, model.replyTo),
    ),
    model.choose !== null && h('p', { class: 'pending-choose' }, model.choose),
    model.archived !== null && h('p', { class: 'archived-drafts', role: 'note' }, model.archived),
    h(
      'div',
      { class: 'alternatives' },
      model.cards.map((card) => {
        const shown = draftCard(context, card)
        reportWhenSeen(context, shown, card.draft)
        return shown
      }),
    ),
  )

const draftCard = (context: ViewContext, card: DraftCard): HTMLElement => {
  const { actions } = context
  const draft = card.draft
  return h(
    'article',
    {
      class: 'draft',
      data: { draftId: draft.id, tour: 'approval' },
      ...(card.focused && { 'aria-current': 'true', tabindex: '-1' }),
    },
    h('span', { class: card.origin.className }, card.origin.text),
    h('p', { class: 'note-body' }, linkedText(card.body)),
    card.basis !== null &&
      h(
        'section',
        { class: 'draft-basis', 'aria-label': strings.draftBasisTitle },
        h('h3', {}, strings.draftBasisTitle),
        ...(card.basis.kind === 'none'
          ? [h('p', { class: 'basis-missing' }, strings.draftBasisMissing)]
          : card.basis.lines.map((line) => h('p', {}, linkedText(line)))),
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
    card.actions !== null &&
      card.readAgain !== null &&
      h(
        'div',
        { class: 'draft-actions draft-changed' },
        h('p', { role: 'alert' }, card.readAgain.notice),
        button(card.readAgain.confirm, () => actions.confirmDraftRead(draft), { class: 'primary' }),
        button(strings.discard, () => actions.discardDraft(draft, { attempt: 'draft' }), { class: 'danger' }),
      ),
    card.actions !== null &&
      card.readAgain === null &&
      h(
        'div',
        { class: 'draft-actions' },
        button(
          strings.send,
          () => actions.approveDraft(draft, null, card.actions!.alternatives, { attempt: 'draft' }),
          { class: 'primary' },
        ),
        h(
          'button',
          {
            type: 'button',
            ...opensDialog(context, strings.editDraftTitle, () =>
              draftEditor(context, draft, card.actions!.alternatives),
            ),
          },
          strings.edit,
        ),
        card.actions.changeChannel !== null &&
          h(
            'button',
            {
              type: 'button',
              class: 'change-channel',
              ...opensDialog(context, strings.changeChannel, (life) =>
                readdressForm(context, life, draft, card.actions!.changeChannel!),
              ),
            },
            strings.changeChannel,
          ),
        button(strings.discard, () => actions.discardDraft(draft, { attempt: 'draft' }), { class: 'danger' }),
      ),
  )
}

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

const draftEditor = (
  context: ViewContext,
  draft: AsRead.Note,
  alternatives: ReadonlyArray<AsRead.Note>,
): Child => {
  const text = h('textarea', {
    name: 'body',
    rows: '6',
    required: true,
    autofocus: true,
    'aria-label': strings.editDraftLabel,
  })
  text.value = draft.body
  let baseline = draft
  const changed = h('div', { class: 'draft-changed', role: 'alert' })
  const save = button(strings.saveDraft, () =>
    context.actions.saveDraft(baseline, text.value, { done: () => closeDialog(context), attempt: 'draft' }),
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
    const shown = [h('p', {}, now.notice), h('p', { class: 'note-body' }, linkedText(now.body))]
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
          context.actions.approveDraft(baseline, text.value, alternatives, {
            done: () => closeDialog(context),
            failed: (error) => {
              if (error._tag === 'Conflict') showChange()
            },
            attempt: 'draft',
          })
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

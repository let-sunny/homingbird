import type { AsRead } from '@homingbird/protocol'
import { type Child, h, linkedText } from '@homingbird/ui'
import type { DraftCard, DraftsItemModel } from '../models/drafts-item.ts'
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
    { class: 'draft', data: { draftId: draft.id } },
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
const reportWhenSeen = (context: ViewContext, card: HTMLElement, draft: AsRead.Note): void => {
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
    'aria-label': strings.editDraftLabel,
  })
  text.value = draft.body
  return h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.approveDraft(draft, text.value, alternatives, {
            done: () => closeDialog(context),
            attempt: 'draft',
          })
        },
      },
    },
    text,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      button(strings.saveDraft, () =>
        context.actions.saveDraft(draft, text.value, { done: () => closeDialog(context), attempt: 'draft' }),
      ),
      h('button', { type: 'submit', class: 'primary' }, strings.sendEdited),
    ),
  )
}

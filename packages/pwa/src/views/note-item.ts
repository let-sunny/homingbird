import type { AsRead, ConversationId } from '@homingbird/protocol'
import { type Lifetime, h, linkedText } from '@homingbird/ui'
import type { NoteItemModel } from '../models/note-item.ts'
import { strings } from '../strings.ts'
import { authorButton } from './author-details.ts'
import { moveForm } from './channel-picker.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { opensDialog } from './dialog.ts'
import { button, timeLabel } from './parts.ts'

/** One sent note in the thread; a click on it, away from its controls, marks it as the one looked at. */
export const renderNoteItem = (
  context: ViewContext,
  life: Lifetime,
  model: NoteItemModel,
  note: AsRead.Note,
  conversationId: ConversationId,
): HTMLElement => {
  const { actions } = context
  const ACTIONS = {
    reply: () => actions.chooseReplyTarget(conversationId, note.id),
    'ask-agent': () =>
      actions.askAgent({ destination: { inReplyTo: note.id }, instruction: '', agentId: null }),
  }
  const li = h(
    'li',
    { class: model.className, data: { noteId: model.noteId, unread: String(model.unread) } },
    h('span', { class: 'note-face' }, model.author !== null && authorButton(context, life, model.author)),
    h(
      'div',
      { class: 'note-column' },
      model.spokenAuthorship !== null && h('span', { class: 'visually-hidden' }, model.spokenAuthorship),
      model.spokenSent !== null && h('span', { class: 'visually-hidden' }, model.spokenSent),
      model.authorName !== null && h('span', { class: 'note-author' }, model.authorName),
      h(
        'div',
        { class: 'bubble', ...(model.bubbleTitle !== null && { title: model.bubbleTitle }) },
        model.quote !== null && h('blockquote', { class: 'quote' }, model.quote),
        h('p', { class: 'note-body' }, linkedText(model.body)),
      ),
      model.basis !== null &&
        h(
          'details',
          { class: model.basis.className },
          h('summary', {}, strings.draftBasisTitle),
          ...model.basis.lines.map((line) => h('p', {}, linkedText(line))),
        ),
      model.answeredBy !== null &&
        h(
          'p',
          { class: 'answered-by' },
          renderAvatar(context, model.answeredBy.avatar),
          model.answeredBy.text,
        ),
      model.release !== null &&
        h(
          'p',
          { class: 'released', role: 'status' },
          h('span', {}, model.release.text),
          model.release.askAnyway !== null &&
            button(model.release.askAnyway, ACTIONS['ask-agent'], { class: 'ask-anyway' }),
        ),
      model.meta !== null &&
        h(
          'div',
          { class: 'note-meta' },
          model.meta.time !== null && h('span', { 'aria-hidden': 'true' }, timeLabel(model.meta.time)),
          model.meta.mark !== null &&
            h(
              'span',
              {
                class: `state-mark is-${model.meta.mark.state}`,
                role: 'img',
                'aria-label': model.meta.mark.label,
                title: model.meta.mark.label,
                data: { state: model.meta.mark.state },
              },
              h('span', { class: 'state-glyph', 'aria-hidden': 'true' }, model.meta.mark.glyph),
              model.meta.mark.count !== null &&
                h('span', { class: 'state-count', 'aria-hidden': 'true' }, model.meta.mark.count),
            ),
        ),
      model.actions.length > 0 &&
        h(
          'div',
          { class: 'note-actions' },
          model.actions.map((action) =>
            action.kind === 'move'
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'link move-question',
                    ...opensDialog(context, strings.moveTitle, (dialogLife) =>
                      moveForm(context, dialogLife, note, conversationId),
                    ),
                  },
                  action.label,
                )
              : button(action.label, ACTIONS[action.kind], {
                  class: action.kind === 'reply' ? 'link' : 'link ask-reply',
                }),
          ),
        ),
    ),
  )
  if (context.document.find(`.notes .is-active[data-note-id="${model.noteId}"]`) !== null)
    li.classList.add('is-active')
  li.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a, button, .author-details') !== null) return
    for (const other of li.parentElement?.querySelectorAll('.note.is-active') ?? [])
      if (other !== li) other.classList.remove('is-active')
    li.classList.toggle('is-active')
  })
  return li
}

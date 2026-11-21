import type { AsRead, ConversationId } from '@homingbird/protocol'
import { type Lifetime, h, linkedText } from '@homingbird/ui'
import type { NoteItemModel } from '../models/note-item.ts'
import { strings } from '../strings.ts'
import { authorButton } from './author-details.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { actionMenu } from './menu.ts'
import { button, sourceList, timeLabel } from './parts.ts'

/** One sent note in the thread; a click on it, away from its controls, marks it as the one looked at. */
export const renderNoteItem = (
  context: ViewContext,
  life: Lifetime,
  model: NoteItemModel,
  note: AsRead.Note,
  conversationId: ConversationId,
): HTMLElement => {
  const { actions } = context
  const askAgent = (): void =>
    actions.askAgent({ destination: { inReplyTo: note.id }, instruction: '', agentId: null })
  const ACTIONS: Readonly<Record<NoteItemModel['menu']['items'][number]['kind'], () => void>> = {
    'ask-agent': askAgent,
    copy: () => copyNote(context, note.body),
  }
  const more = actionMenu(context, {
    id: model.menu.id,
    label: model.menu.label,
    triggerClass: 'note-more',
    menuClass: 'note-menu',
    items: model.menu.items.map((item) =>
      button(item.label, ACTIONS[item.kind], { class: `menu-item ${ITEM_CLASSES[item.kind]}` }),
    ),
  })
  const li = h(
    'li',
    {
      class: model.className,
      tabindex: '-1',
      data: { noteId: model.noteId, unread: String(model.unread) },
    },
    h('span', { class: 'note-face' }, model.author !== null && authorButton(context, life, model.author)),
    h(
      'div',
      { class: 'note-column' },
      model.spokenAuthorship !== null && h('span', { class: 'visually-hidden' }, model.spokenAuthorship),
      model.spokenSent !== null && h('span', { class: 'visually-hidden' }, model.spokenSent),
      model.authorName !== null && h('span', { class: 'note-author' }, model.authorName),
      h(
        'div',
        { class: 'bubble-row' },
        h(
          'div',
          { class: 'bubble', ...(model.bubbleTitle !== null && { title: model.bubbleTitle }) },
          model.quote !== null && h('blockquote', { class: 'quote' }, model.quote),
          h('p', { class: 'note-body' }, linkedText(model.body)),
        ),
        h(
          'div',
          { class: 'note-toolbar' },
          model.reply !== null &&
            button(model.reply, () => actions.chooseReplyTarget(conversationId, note.id), {
              class: 'note-reply',
            }),
          more.trigger,
        ),
        more.menu,
      ),
      model.basis !== null &&
        h(
          'details',
          { class: model.basis.className },
          h('summary', {}, model.basis.title),
          ...model.basis.lines.map((line) => h('p', {}, linkedText(line))),
          sourceList(model.basis.sources),
        ),
      model.approval !== null && h('p', { class: 'note-approval' }, model.approval),
      model.answeredBy !== null &&
        h(
          'p',
          { class: 'answered-by' },
          renderAvatar(context, model.answeredBy.avatar),
          model.answeredBy.text,
        ),
      model.waits !== null &&
        h(
          'p',
          { class: model.waits.warning ? 'question-waits is-warning' : 'question-waits', role: 'status' },
          model.waits.text,
        ),
      model.noAnswer !== null && h('p', { class: 'no-answer hint' }, model.noAnswer),
      model.release !== null &&
        h(
          'p',
          { class: 'released', role: 'status' },
          h('span', {}, model.release.text),
          model.release.askAnyway !== null &&
            button(model.release.askAnyway, askAgent, { class: 'ask-anyway' }),
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
    ),
  )
  more.opensFrom(li)
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

const copyNote = (context: ViewContext, body: string): void => {
  void context.page
    .copyText(body)
    .then((isCopied) =>
      context.state.notice.set(
        isCopied
          ? { kind: 'info', text: strings.noteCopied }
          : { kind: 'error', text: strings.noteNotCopied },
      ),
    )
}

const ITEM_CLASSES: Readonly<Record<NoteItemModel['menu']['items'][number]['kind'], string>> = {
  'ask-agent': 'ask-reply',
  copy: 'copy-note',
}

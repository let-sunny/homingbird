import type { AsRead, ConversationId } from '@homingbird/protocol'
import { type Child, type Lifetime, h, linkedText } from '@homingbird/ui'
import type { DebateResultNote, NoteItemModel, NoteMenuItem } from '../models/note-item.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { authorButton } from './author-details.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { actionMenu } from './menu.ts'
import { noteBody } from './note-body.ts'
import { button, sourceList, timeLabel } from './parts.ts'
import { teachFromMiss } from './teaching.ts'

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
  const reply = (): void => actions.replyTo(conversationId, note.id)
  const ACTIONS: Readonly<Record<NoteMenuItem['kind'], () => void>> = {
    reply,
    'ask-agent': askAgent,
    copy: () => copyText(context, note.body, strings.noteCopied),
    'copy-link': () => copyText(context, noteLink(context, conversationId, note), strings.noteLinkCopied),
  }
  const more = actionMenu(context, {
    id: model.menu.id,
    label: model.menu.label,
    triggerClass: 'note-more',
    menuClass: 'note-menu',
    items: model.menu.items.map((item) => menuItem(model.menu.id, item, ACTIONS[item.kind])),
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
          model.quote !== null &&
            h(
              'a',
              { class: 'quote', href: model.quote.href, title: model.quote.label },
              h('span', { class: 'visually-hidden' }, `${model.quote.label}: `),
              model.quote.text,
            ),
          model.debateResult === null
            ? collapsibleBody(context, model)
            : debateResultBody(context, model, model.debateResult),
        ),
        h(
          'div',
          { class: 'note-toolbar' },
          model.reply !== null &&
            button(model.reply, reply, {
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
      model.answerDiscarded !== null &&
        h(
          'p',
          { class: 'answer-discarded', role: 'status' },
          h('span', {}, model.answerDiscarded.text),
          button(model.answerDiscarded.reply, reply, { class: 'reply-yourself' }),
        ),
      model.release !== null &&
        h(
          'p',
          { class: 'released', role: 'status' },
          h('span', {}, model.release.text),
          model.release.askAnyway !== null &&
            button(model.release.askAnyway, askAgent, { class: 'ask-anyway' }),
          model.release.teach !== null &&
            teachFromMiss(context, model.release.teach.label, model.release.teach.seed),
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

/**
 * The note's text; a long one shows its start, and a button opens the rest in place. A note drawn again
 * while the person had it open stays open.
 */
const collapsibleBody = (context: ViewContext, model: NoteItemModel): Child => {
  const id = `note-body-${model.noteId}`
  const body = noteBody(context, model.body)
  body.id = id
  const long = model.longBody
  if (long === null) return body
  const toggle: HTMLButtonElement = h('button', {
    type: 'button',
    class: 'link note-more-text',
    'aria-controls': id,
    on: { click: () => show(!body.classList.contains('is-collapsed')) },
  })
  const show = (collapsed: boolean): void => {
    body.classList.toggle('is-collapsed', collapsed)
    toggle.setAttribute('aria-expanded', String(!collapsed))
    toggle.textContent = collapsed ? long.more : long.less
  }
  show(context.document.find(`.note-body[id="${id}"]:not(.is-collapsed)`) === null)
  return [body, toggle]
}

const menuItem = (menuId: string, item: NoteMenuItem, choose: () => void): Child => {
  const className = `menu-item ${ITEM_CLASSES[item.kind]}`
  if (item.reason === null) return button(item.label, choose, { class: className })
  const reasonId = `${menuId}-${item.kind}-reason`
  return [
    h(
      'button',
      { type: 'button', class: className, disabled: true, 'aria-describedby': reasonId },
      item.label,
    ),
    h('small', { id: reasonId, class: 'menu-reason' }, item.reason),
  ]
}

/** A posted debate result: what the agents settled and the next steps, the whole note folded, the room a link away. */
const debateResultBody = (
  context: ViewContext,
  model: NoteItemModel,
  result: DebateResultNote,
): ReadonlyArray<Child> => [
  ...(result.parts === null
    ? [collapsibleBody(context, model)]
    : [
        h('p', { class: 'debate-note-heading' }, h('strong', {}, result.parts.heading)),
        noteBody(context, result.parts.summary),
        result.parts.nextSteps.length > 0 &&
          h('p', { class: 'debate-note-heading' }, result.parts.nextStepsHeading),
        result.parts.nextSteps.length > 0 &&
          h(
            'ul',
            { class: 'debate-note-steps' },
            result.parts.nextSteps.map((step) => h('li', {}, linkedText(step))),
          ),
        h(
          'details',
          { class: 'debate-note-whole' },
          h('summary', {}, result.whole),
          noteBody(context, model.body),
        ),
      ]),
  h('a', { class: 'debate-note-room', href: result.room.href }, result.room.label),
]

const copyText = (context: ViewContext, text: string, copied: string): void => {
  void context.page
    .copyText(text)
    .then((isCopied) =>
      context.state.notice.set(
        isCopied ? { kind: 'info', text: copied } : { kind: 'error', text: strings.noteNotCopied },
      ),
    )
}

/** The address that opens the conversation at this note, for pasting elsewhere. */
const noteLink = (context: ViewContext, conversationId: ConversationId, note: AsRead.Note): string =>
  context.page.linkTo(hrefFor({ name: 'conversation', id: conversationId, draft: null, note: note.id }))

const ITEM_CLASSES: Readonly<Record<NoteMenuItem['kind'], string>> = {
  reply: 'reply-note',
  'ask-agent': 'ask-reply',
  copy: 'copy-note',
  'copy-link': 'copy-note-link',
}

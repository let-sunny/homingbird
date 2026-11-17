import { type ConversationId, type Me, type Note, describeStatus, summarize } from '@homingbird/protocol'
import { type Child, type Lifetime, h, keyedRegion, linkedText, region } from '@homingbird/ui'
import {
  approveDraft,
  discardDraft,
  launch,
  loadOlderNotes,
  loadThread,
  markRead,
  replyTargetIn,
  saveDraft,
  sendNote,
} from '../actions.ts'
import { conversations, directory, members, replyTargets, sendingIn, threads } from '../state.ts'
import { strings } from '../strings.ts'
import { type ThreadItem, conversationTitle, excerpt, isUnreadBy, otherParticipants, threadItems } from '../thread.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { avatar, backLink, button, emptyWithPip, presenceBadges, timeLabel } from './parts.ts'
import { type PipState, pip } from './pip.ts'

export const threadView = (life: Lifetime, me: Me, id: ConversationId): HTMLElement => {
  launch(loadThread(id))
  const scroller = h('div', { class: 'thread-scroll', tabindex: '0' })
  const list = h('ol', { class: 'notes', 'aria-live': 'polite', 'aria-relevant': 'additions' })
  const follow = followNewNotes(life, scroller)
  const seen = markReadWhenSeen(life, scroller, me, id)

  keyedRegion(life, list, [threads, members, replyTargets], () => threadItems(notesIn(id)), {
    key: (item) => item.key,
    signature: (item) => JSON.stringify([item, namesIn(item), replyTargetIn(id)]),
    render: (item) => seen.watch(item.type === 'note' ? noteItem(item.note, me, id) : draftsItem(item, id)),
  })
  life.add(threads.subscribe(follow.afterDraw))

  scroller.append(
    region(life, [threads], () => {
      const thread = threads.get().get(id)
      if (thread === undefined) return h('p', { class: 'loading' }, strings.loading)
      if (thread.hasMore) return button(strings.loadOlder, () => launch(loadOlderNotes(id)), { class: 'load-older' })
      return thread.notes.length === 0 && emptyWithPip('waving', 4, strings.emptyThread)
    }),
    list,
    h('p', { class: 'newer-below', 'aria-hidden': 'true' }, `↓ ${strings.newerBelow}`),
  )
  return h('section', { class: 'thread' }, threadHead(life, me, id), scroller, composer(life, me, id))
}

const notesIn = (id: ConversationId): ReadonlyArray<Note> => threads.get().get(id)?.notes ?? []

const noteById = (conversationId: ConversationId, noteId: string | null): Note | null =>
  notesIn(conversationId).find((note) => note.id === noteId) ?? null

const nameOf = (memberId: string): string => members.get().get(memberId as never)?.name ?? strings.formerMember

const namesIn = (item: ThreadItem): string[] =>
  item.type === 'note' ? [nameOf(item.note.authorId)] : item.drafts.map((draft) => nameOf(draft.authorId))

const threadHead = (life: Lifetime, me: Me, id: ConversationId): HTMLElement =>
  region(
    life,
    [conversations, members, directory],
    () => {
      const conversation = conversations.get().find((candidate) => candidate.id === id)
      if (conversation === undefined) return [backLink(), h('h1', {}, strings.loading)]
      const title = conversationTitle(conversation, members.get(), me.member.id, strings.formerMember)
      const others = otherParticipants(conversation, me.member.id)
      const entry = directory.get().find((candidate) => candidate.member.id === others[0])
      return [
        backLink(),
        avatar(title),
        h(
          'div',
          { class: 'thread-who' },
          h('h1', {}, title),
          conversation.kind === 'dm' && entry !== undefined && h('p', { class: 'thread-profile' }, entry.member.profile),
        ),
        conversation.kind === 'dm' && entry !== undefined && presenceBadges(entry.presence, true),
      ]
    },
    { class: 'thread-head' },
  )

const noteItem = (note: Note, me: Me, conversationId: ConversationId): HTMLElement => {
  const mine = note.authorId === me.member.id
  const quoted = noteById(conversationId, note.inReplyTo)
  const isGroup = (conversations.get().find((c) => c.id === conversationId)?.participantIds.length ?? 2) > 2
  return h(
    'li',
    {
      class: `note ${mine ? 'is-mine' : 'is-theirs'}`,
      data: { noteId: note.id, unread: String(isUnreadBy(note, me.member.id)) },
    },
    !mine && isGroup && h('span', { class: 'note-author' }, nameOf(note.authorId)),
    h(
      'div',
      { class: 'bubble' },
      quoted !== null && h('blockquote', { class: 'quote' }, excerpt(quoted.body)),
      h('p', { class: 'note-body' }, linkedText(note.body)),
    ),
    h(
      'div',
      { class: 'note-meta' },
      originBadge(note),
      note.sentAt !== null && timeLabel(note.sentAt),
      mine && pip(statusPip(note), 1),
      h('span', { class: 'note-status' }, describeStatus(summarize(note.receipts))),
      !mine &&
        button(strings.reply, () => replyTargets.update((targets) => new Map(targets).set(conversationId, note.id)), {
          class: 'link',
        }),
    ),
  )
}

const statusPip = (note: Note): PipState => {
  const summary = summarize(note.receipts)
  return summary.drafting > 0 ? 'drafting' : summary.read > 0 || summary.replied > 0 ? 'read' : 'delivered'
}

const originBadge = (note: Note): HTMLElement =>
  h('span', { class: `origin is-${note.origin}` }, strings.origin[note.origin](note.agentName))

const draftsItem = (item: Extract<ThreadItem, { type: 'drafts' }>, conversationId: ConversationId): HTMLElement => {
  const target = noteById(conversationId, item.inReplyTo)
  return h(
    'li',
    { class: 'pending' },
    h(
      'div',
      { class: 'pending-head' },
      pip('awaiting-approval', 2),
      h('strong', {}, strings.waitingForApproval),
      h('span', {}, target === null ? strings.newNoteDraft : `${strings.draftReplyTo} “${excerpt(target.body, 60)}”`),
    ),
    item.drafts.length > 1 && h('p', { class: 'pending-choose' }, strings.chooseOne(item.drafts.length)),
    h('div', { class: 'alternatives' }, item.drafts.map(draftCard)),
  )
}

const draftCard = (draft: Note): HTMLElement =>
  h(
    'article',
    { class: 'draft', data: { draftId: draft.id } },
    originBadge(draft),
    h('p', { class: 'note-body' }, linkedText(draft.body)),
    h(
      'div',
      { class: 'draft-actions' },
      button(strings.send, () => launch(approveDraft(draft)), { class: 'primary' }),
      h('button', { type: 'button', ...opensDialog(strings.editDraftTitle, () => draftEditor(draft)) }, strings.edit),
      button(strings.discard, () => launch(discardDraft(draft)), { class: 'danger' }),
    ),
  )

const draftEditor = (draft: Note): Child => {
  const text = h('textarea', { name: 'body', rows: '6', required: true, 'aria-label': strings.editDraftLabel })
  text.value = draft.body
  return h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(approveDraft(draft, text.value), closeDialog)
        },
      },
    },
    text,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      button(strings.saveDraft, () => launch(saveDraft(draft, text.value), closeDialog)),
      h('button', { type: 'submit', class: 'primary' }, strings.sendEdited),
    ),
  )
}

const composer = (life: Lifetime, me: Me, id: ConversationId): HTMLElement => {
  const text = h('textarea', {
    name: 'body',
    rows: '1',
    required: true,
    placeholder: strings.composerPlaceholder,
    'aria-label': strings.composerLabel,
    maxlength: '16000',
  })
  const send = (): void => {
    const body = text.value.trim()
    if (body === '') return
    text.value = ''
    launch(sendNote(id, body))
  }
  text.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    send()
  })
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
    region(life, [threads, replyTargets, directory, conversations, sendingIn], () => [
      sendingIn.get().has(id) && h('p', { class: 'sending', role: 'status' }, pip('sending', 2), strings.sending),
      replyChip(id),
      cannotMessageNotice(me, id),
    ]),
    h('div', { class: 'composer-row' }, text, h('button', { type: 'submit', class: 'primary send' }, strings.send)),
    h('small', { class: 'composer-hint' }, strings.composerHint),
  )
}

const replyChip = (id: ConversationId): Child => {
  const target = noteById(id, replyTargetIn(id))
  return (
    target !== null &&
    h(
      'p',
      { class: 'reply-chip' },
      h('span', {}, `${strings.replyingTo} “${excerpt(target.body, 60)}”`),
      button('✕', () => replyTargets.update((targets) => new Map(targets).set(id, null)), {
        class: 'icon',
        'aria-label': strings.stopReplying,
      }),
    )
  )
}

const cannotMessageNotice = (me: Me, id: ConversationId): Child => {
  const conversation = conversations.get().find((candidate) => candidate.id === id)
  if (conversation === undefined || conversation.kind !== 'dm') return null
  const other = otherParticipants(conversation, me.member.id)[0]
  const entry = directory.get().find((candidate) => candidate.member.id === other)
  return (
    entry !== undefined &&
    !entry.canMessage &&
    h('p', { class: 'composer-blocked', role: 'note' }, pip('blocked', 2), strings.cannotMessage)
  )
}

const NEAR_BOTTOM_PX = 120

const followNewNotes = (life: Lifetime, scroller: HTMLElement) => {
  let pinned = true
  const onScroll = (): void => {
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX
  }
  scroller.addEventListener('scroll', onScroll, { passive: true })
  life.add(() => scroller.removeEventListener('scroll', onScroll))
  return {
    afterDraw: (): void => {
      if (pinned) requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight }))
    },
  }
}

const markReadWhenSeen = (life: Lifetime, scroller: HTMLElement, me: Me, id: ConversationId) => {
  const reported = new Set<string>()
  const report = (element: Element): void => {
    const note = noteById(id, (element as HTMLElement).dataset.noteId ?? null)
    if (note === null || reported.has(note.id) || !isUnreadBy(note, me.member.id)) return
    reported.add(note.id)
    launch(markRead(note))
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (document.visibilityState !== 'visible') return
      for (const entry of entries) if (entry.isIntersecting) report(entry.target)
    },
    { root: scroller, threshold: 0.6 },
  )
  life.add(() => observer.disconnect())
  return {
    watch: (element: HTMLElement): HTMLElement => {
      if (element.dataset.unread === 'true') observer.observe(element)
      return element
    },
  }
}

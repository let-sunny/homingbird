import { systemClock } from '@homingbird/kernel'
import {
  type Conversation,
  type ConversationId,
  type Me,
  type MemberId,
  type Note,
  type Topic,
  summarize,
} from '@homingbird/protocol'
import type { StateName } from '@homingbird/sprites'
import { type Child, type Lifetime, h, keyedRegion, linkedText, region, signal } from '@homingbird/ui'
import {
  approveDraft,
  askAgent,
  discardDraft,
  launch,
  loadOlderNotes,
  loadPeople,
  loadThread,
  loadTopics,
  markRead,
  replyTargetIn,
  saveDraft,
  sendNote,
  withdrawRequest,
} from '../actions.ts'
import { characterOf } from '../characters.ts'
import { waitingRequests } from '../draft-requests.ts'
import { MISSING, orMissing } from '../missing.ts'
import { hrefFor } from '../routes.ts'
import { spriteOwner } from '../sprite-owner.ts'
import {
  conversations,
  directory,
  draftRequests,
  members,
  openedForThePerson,
  releases,
  replyTargets,
  sendingIn,
  threads,
  topics,
} from '../state.ts'
import { listOf, strings } from '../strings.ts'
import {
  type ThreadItem,
  alternativesLeftAfterSending,
  answeredBy,
  conversationTitle,
  draftDestination,
  excerpt,
  isArchived,
  isOpenQuestion,
  isUnreadBy,
  myNoteState,
  otherParticipants,
  readProgress,
  showsAuthors,
  statusOf,
  threadItems,
} from '../thread.ts'
import { topicLabel, topicOfRoom } from '../topics.ts'
import { agentAsk } from './agent-ask.ts'
import { groupAvatar, memberAvatar } from './character-avatar.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import {
  archivedMark,
  backLink,
  button,
  emptyWithPip,
  presenceBadges,
  timeLabel,
  topicCounts,
} from './parts.ts'
import { pip } from './pip.ts'
import { privateMark, roomControls, rosters } from './topic-membership.ts'
import { moveForm, readdressForm } from './topic-picker.ts'

export const threadView = (life: Lifetime, me: Me, id: ConversationId): HTMLElement => {
  const missing = signal(false)
  launch(orMissing(loadThread(id)), (found) => missing.set(found === MISSING))
  launch(loadPeople)
  launch(loadTopics(''))
  const scroller = h('div', { class: 'thread-scroll', tabindex: '0' })
  const list = h('ol', { class: 'notes', 'aria-live': 'polite', 'aria-relevant': 'additions' })
  const follow = followNewNotes(life, scroller)
  const seen = markReadWhenSeen(life, scroller, me, id)

  keyedRegion(
    life,
    list,
    [threads, members, replyTargets, draftRequests, topics, conversations, releases],
    () => threadItems(notesIn(id), draftRequests.get()),
    {
      key: (item) => item.key,
      signature: (item) => JSON.stringify([item, peopleIn(item, me), roomState(id), replyTargetIn(id)]),
      render: (item) => seen.watch(item.type === 'note' ? noteItem(item, me, id) : draftsItem(item, me, id)),
    },
  )
  life.add(threads.subscribe(follow.afterDraw))
  life.add(topics.subscribe(follow.afterDraw))
  life.add(members.subscribe(follow.afterDraw))

  scroller.append(
    region(life, [threads], () => {
      const thread = threads.get().get(id)
      if (thread === undefined) return h('p', { class: 'loading' }, strings.loading)
      if (thread.hasMore)
        return button(strings.loadOlder, () => launch(loadOlderNotes(id)), { class: 'load-older' })
      return thread.notes.length === 0 && emptyWithPip('waving', 4, strings.emptyThread)
    }),
    list,
    h('p', { class: 'newer-below', 'aria-hidden': 'true' }, `↓ ${strings.newerBelow}`),
  )
  const thread = h(
    'section',
    { class: 'thread' },
    threadHead(life, me, id),
    scroller,
    region(
      life,
      [conversations],
      () => (isArchived(roomOf(id)) ? archivedComposer() : composer(life, me, id)),
      {
        class: 'composer-host',
      },
    ),
  )
  return region(life, [missing], () => (missing.get() ? missingConversation() : thread), {
    class: 'thread-host',
  })
}

const missingConversation = (): HTMLElement =>
  emptyWithPip(
    'failed',
    4,
    strings.conversationMissing,
    h('a', { class: 'button', href: hrefFor({ name: 'home' }) }, strings.backHome),
  )

const notesIn = (id: ConversationId): ReadonlyArray<Note> => threads.get().get(id)?.notes ?? []

const noteById = (conversationId: ConversationId, noteId: string | null): Note | null =>
  notesIn(conversationId).find((note) => note.id === noteId) ?? null

const roomOf = (id: ConversationId): Conversation | undefined =>
  conversations.get().find((candidate) => candidate.id === id)

const memberOf = (memberId: MemberId) => members.get().get(memberId)

const nameOf = (memberId: MemberId): string => memberOf(memberId)?.name ?? strings.formerMember

const peopleIn = (item: ThreadItem, me: Me): unknown[] => {
  const authors = item.type === 'note' ? [item.note.authorId] : item.drafts.map((draft) => draft.authorId)
  const room = item.type === 'note' ? [] : (roomOf(item.drafts[0]!.conversationId)?.participantIds ?? [])
  return [...authors, ...room, me.member.id].map((memberId) => {
    const member = memberOf(memberId)
    return [memberId, member?.name, characterOf(member).id, member?.character ?? null]
  })
}

const roomState = (id: ConversationId): unknown[] => {
  const room = roomOf(id)
  const topic = topicOfRoom(topics.get(), id)
  return [room?.kind, room?.archivedAt ?? null, topic, [...releases.get()]]
}

const spriteOf = (memberId: MemberId, state: StateName): HTMLElement =>
  memberAvatar(memberOf(spriteOwner({ kind: 'note', authorId: memberId }) as MemberId), {
    state,
    labelled: false,
  })

const threadHead = (life: Lifetime, me: Me, id: ConversationId): HTMLElement =>
  region(
    life,
    [conversations, members, directory, topics, rosters],
    () => {
      const conversation = roomOf(id)
      if (conversation === undefined) return [backLink(), h('h1', {}, strings.loading)]
      const title = conversationTitle(conversation, members.get(), me.member.id, strings.formerMember)
      if (conversation.kind === 'topic' || isArchived(conversation)) return topicHead(conversation, title)
      const others = otherParticipants(conversation, me.member.id)
      const entry = directory.get().find((candidate) => candidate.member.id === others[0])
      const people = others.map((other) => memberOf(other))
      return [
        backLink(),
        conversation.kind !== 'dm' && people.length > 1
          ? groupAvatar(people)
          : memberAvatar(
              memberOf(
                spriteOwner({
                  kind: 'conversation',
                  viewerId: me.member.id,
                  participantIds: conversation.participantIds,
                  arrivedFrom: null,
                }) as MemberId,
              ),
            ),
        h(
          'div',
          { class: 'thread-who' },
          h('h1', {}, title),
          conversation.kind === 'dm' &&
            entry !== undefined &&
            h('p', { class: 'thread-profile' }, entry.member.profile),
        ),
        conversation.kind === 'dm' && entry !== undefined && presenceBadges(entry.presence, true),
      ]
    },
    { class: 'thread-head' },
  )

const topicHead = (conversation: Conversation, title: string): Child => {
  const archived = isArchived(conversation)
  const topic = archived ? null : topicOfRoom(topics.get(), conversation.id)
  return [
    backLink(),
    h('span', { class: 'avatar is-topic', 'aria-hidden': 'true' }, '#'),
    h(
      'div',
      { class: 'thread-who' },
      h('h1', {}, title, topic !== null && privateMark(topic), archived && archivedMark()),
      topic !== null &&
        h(
          'div',
          { class: 'thread-profile topic-head-meta' },
          topicCounts(topic),
          h('span', { class: 'topic-head-description' }, topic.description),
        ),
    ),
    topic !== null && roomControls(topic),
  ]
}

const noteItem = (
  item: Extract<ThreadItem, { type: 'note' }>,
  me: Me,
  conversationId: ConversationId,
): HTMLElement => {
  const { note, leadsRun } = item
  const mine = note.authorId === me.member.id
  const quoted = noteById(conversationId, note.inReplyTo)
  const room = roomOf(conversationId)
  const archived = isArchived(room)
  const inRoom = showsAuthors(room)
  const isTopicQuestion = room?.kind === 'topic' && note.inReplyTo === null
  const answerers = isTopicQuestion ? answeredBy(note) : []
  const status = statusOf(summarize(note.receipts))
  return h(
    'li',
    {
      class: `note ${mine ? 'is-mine' : 'is-theirs'} ${leadsRun ? 'leads-run' : 'follows-run'}`,
      data: { noteId: note.id, unread: String(isUnreadBy(note, me.member.id)) },
    },
    !mine &&
      h(
        'span',
        { class: 'note-face' },
        leadsRun &&
          memberAvatar(memberOf(spriteOwner({ kind: 'note', authorId: note.authorId }) as MemberId), {
            labelled: true,
          }),
      ),
    h(
      'div',
      { class: 'note-column' },
      inRoom && leadsRun && h('span', { class: 'note-author' }, mine ? strings.you : nameOf(note.authorId)),
      h(
        'div',
        { class: 'bubble' },
        quoted !== null && h('blockquote', { class: 'quote' }, excerpt(quoted.body)),
        h('p', { class: 'note-body' }, linkedText(note.body)),
      ),
      answerers.length > 0 &&
        h(
          'p',
          { class: 'answered-by' },
          spriteOf(answerers[0]!, 'accepted'),
          strings.answeredBy({ names: listOf(answerers.map(nameOf)) }),
        ),
      !mine && !archived && releaseNotice(note),
      h(
        'div',
        { class: 'note-meta' },
        originBadge(note),
        note.sentAt !== null && timeLabel(note.sentAt),
        mine &&
          h(
            'span',
            { class: 'note-status', data: { state: status } },
            spriteOf(me.member.id, myNoteState(status)),
            h('span', {}, inRoom ? roomStatus(note) : dmStatus(note)),
          ),
        !mine &&
          !archived &&
          button(
            strings.reply,
            () => replyTargets.update((targets) => new Map(targets).set(conversationId, note.id)),
            { class: 'link' },
          ),
        !mine &&
          !archived &&
          button(
            strings.askAgentToReply,
            () => launch(askAgent({ destination: { inReplyTo: note.id }, instruction: '', agentId: null })),
            { class: 'link ask-reply' },
          ),
        isTopicQuestion &&
          !archived &&
          isOpenQuestion(note, notesIn(conversationId)) &&
          h(
            'button',
            {
              type: 'button',
              class: 'link move-question',
              ...opensDialog(strings.moveTitle, (life) => moveForm(life, note, conversationId)),
            },
            strings.moveToTopic,
          ),
      ),
    ),
  )
}

const releaseNotice = (note: Note): Child => {
  const released = releases.get().get(note.id)
  if (released === undefined) return null
  return h(
    'p',
    { class: 'released', role: 'status' },
    pip('discarded', 1),
    h(
      'span',
      {},
      released.reason === null || released.reason.trim() === ''
        ? strings.agentReleasedWithoutReason
        : strings.agentReleased({ reason: released.reason }),
    ),
    button(
      strings.askAnyway,
      () => launch(askAgent({ destination: { inReplyTo: note.id }, instruction: '', agentId: null })),
      { class: 'ask-anyway' },
    ),
  )
}

const dmStatus = (note: Note): string => {
  const summary = summarize(note.receipts)
  if (summary.recipients > 1) return roomStatus(note)
  return strings.status[statusOf(summary)]
}

const roomStatus = (note: Note): string => {
  const { read, of, drafting } = readProgress(note.receipts)
  return drafting > 0 ? strings.readByWhileDrafting({ read, of, drafting }) : strings.readBy({ read, of })
}

const originBadge = (note: Note): HTMLElement =>
  h('span', { class: `origin is-${note.origin}` }, originText(note))

const originText = (note: Note): string =>
  note.origin === 'human' || note.agentName === null
    ? strings.origin[note.origin]
    : strings.originNamed[note.origin]({ agent: note.agentName })

const draftsItem = (
  item: Extract<ThreadItem, { type: 'drafts' }>,
  me: Me,
  conversationId: ConversationId,
): HTMLElement => {
  const target = noteById(conversationId, item.inReplyTo)
  const room = roomOf(conversationId)
  const archived = isArchived(room)
  const topic = room?.kind === 'topic' ? topicOfRoom(topics.get(), conversationId) : null
  const question = topic !== null && item.inReplyTo === null
  return h(
    'li',
    { class: 'pending' },
    h(
      'div',
      { class: 'pending-head' },
      spriteOf(me.member.id, 'awaiting-approval'),
      h('strong', {}, strings.waitingForApproval),
      h(
        'span',
        {},
        target === null ? strings.newNoteDraft : strings.draftReplyTo({ excerpt: excerpt(target.body, 60) }),
      ),
    ),
    item.drafts.length > 1 &&
      h('p', { class: 'pending-choose' }, strings.chooseOne({ count: item.drafts.length })),
    archived && h('p', { class: 'archived-drafts', role: 'note' }, strings.archivedRoomNotice),
    h(
      'div',
      { class: 'alternatives' },
      item.drafts.map((draft) => draftCard(draft, item, me, room, archived, question ? topic : null)),
    ),
  )
}

const draftCard = (
  draft: Note,
  item: Extract<ThreadItem, { type: 'drafts' }>,
  me: Me,
  room: Conversation | undefined,
  archived: boolean,
  topic: Topic | null,
): HTMLElement =>
  h(
    'article',
    { class: 'draft', data: { draftId: draft.id } },
    originBadge(draft),
    h('p', { class: 'note-body' }, linkedText(draft.body)),
    !archived && room !== undefined && destinationLine(draft, me, room, topic),
    !archived &&
      h(
        'div',
        { class: 'draft-actions' },
        button(
          strings.send,
          () =>
            launch(
              approveDraft(draft, undefined, alternativesLeftAfterSending(item, draft.id)),
              undefined,
              'draft',
            ),
          { class: 'primary' },
        ),
        h(
          'button',
          { type: 'button', ...opensDialog(strings.editDraftTitle, () => draftEditor(draft, item)) },
          strings.edit,
        ),
        topic !== null &&
          h(
            'button',
            {
              type: 'button',
              class: 'change-topic',
              ...opensDialog(strings.changeTopic, (life) => readdressForm(life, draft, topic.slug)),
            },
            strings.changeTopic,
          ),
        button(strings.discard, () => launch(discardDraft(draft), undefined, 'draft'), { class: 'danger' }),
      ),
  )

const destinationLine = (draft: Note, me: Me, room: Conversation, topic: Topic | null): HTMLElement => {
  const destination = draftDestination(room, draft, notesIn(room.id), me.member.id)
  const names = listOf(destination.memberIds.map(nameOf))
  return h(
    'p',
    { class: 'draft-destination' },
    topic !== null
      ? [h('span', {}, strings.sendsToTopic({ topic: topicLabel(topic.slug) })), topicCounts(topic)]
      : room.kind === 'topic'
        ? strings.sendsToInRoom({ names, room: conversationTitle(room, members.get(), me.member.id, '') })
        : strings.sendsTo({ names }),
  )
}

const draftEditor = (draft: Note, item: Extract<ThreadItem, { type: 'drafts' }>): Child => {
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
          launch(
            approveDraft(draft, text.value, alternativesLeftAfterSending(item, draft.id)),
            closeDialog,
            'draft',
          )
        },
      },
    },
    text,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      button(strings.saveDraft, () => launch(saveDraft(draft, text.value), closeDialog, 'draft')),
      h('button', { type: 'submit', class: 'primary' }, strings.sendEdited),
    ),
  )
}

const archivedComposer = (): HTMLElement =>
  h(
    'form',
    { class: 'composer is-disabled', 'aria-disabled': 'true' },
    h(
      'p',
      { class: 'archived-notice', id: ARCHIVED_REASON_ID, role: 'note' },
      pip('blocked', 2),
      strings.archivedRoomNotice,
    ),
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

const ARCHIVED_REASON_ID = 'archived-reason'
const BLOCKED_REASON_ID = 'composer-blocked-reason'

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
    launch(sendNote(id, body), undefined, 'draft')
  }
  text.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    send()
  })
  const sendButton = h('button', { type: 'submit', class: 'primary send' }, strings.send)
  const reflectReachability = (): void => {
    const blocked = !mayMessageIn(me, id)
    for (const control of [text, sendButton]) {
      control.disabled = blocked
      if (blocked) control.setAttribute('aria-describedby', BLOCKED_REASON_ID)
      else control.removeAttribute('aria-describedby')
    }
  }
  reflectReachability()
  life.add(directory.subscribe(reflectReachability))
  life.add(conversations.subscribe(reflectReachability))
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
    region(life, [threads, replyTargets, directory, conversations, sendingIn, draftRequests, members], () => [
      sendingIn.get().has(id) &&
        h(
          'p',
          { class: 'sending', role: 'status' },
          memberAvatar(memberOf(me.member.id) ?? me.member, {
            state: 'sending',
            motion: 'loop',
            labelled: false,
          }),
          strings.sending,
        ),
      waitingChips(me, id),
      replyChip(id),
      cannotMessageNotice(me, id),
    ]),
    h('div', { class: 'composer-row' }, text, sendButton),
    h('small', { class: 'composer-hint' }, strings.composerHint),
    agentAsk(life, () => {
      const inReplyTo = replyTargetIn(id)
      return inReplyTo === null ? { conversationId: id } : { inReplyTo }
    }),
  )
}

const waitingChips = (me: Me, id: ConversationId): Child => {
  const waiting = waitingRequests(draftRequests.get(), id, systemClock.now())
  if (waiting.length === 0) return null
  const mine = directory.get().find((entry) => entry.member.id === me.member.id)
  return [
    waiting.map((request) =>
      h(
        'p',
        { class: 'asked-chip', role: 'status', data: { requestId: request.id } },
        spriteOf(me.member.id, 'drafting'),
        h(
          'span',
          {},
          request.instruction === ''
            ? strings.askedAgent
            : strings.askedAgentFor({ instruction: excerpt(request.instruction, 60) }),
        ),
        button(strings.withdraw, () => launch(withdrawRequest(request), undefined, 'request'), {
          class: 'link',
        }),
      ),
    ),
    mine?.presence.agentOnline === false &&
      h(
        'p',
        { class: 'no-agent', role: 'note' },
        pip('offline', 2),
        h('span', {}, strings.noAgentOnline),
        h('a', { href: hrefFor({ name: 'connect' }) }, strings.connectAgent),
      ),
  ]
}

const replyChip = (id: ConversationId): Child => {
  const target = noteById(id, replyTargetIn(id))
  return (
    target !== null &&
    h(
      'p',
      { class: 'reply-chip' },
      h('span', {}, strings.replyingTo({ excerpt: excerpt(target.body, 60) })),
      button('✕', () => replyTargets.update((targets) => new Map(targets).set(id, null)), {
        class: 'icon',
        'aria-label': strings.stopReplying,
      }),
    )
  )
}

const cannotMessageNotice = (me: Me, id: ConversationId): Child =>
  !mayMessageIn(me, id) &&
  h(
    'p',
    { class: 'composer-blocked', id: BLOCKED_REASON_ID, role: 'note' },
    pip('blocked', 2),
    strings.cannotMessage,
  )

const mayMessageIn = (me: Me, id: ConversationId): boolean => {
  const conversation = roomOf(id)
  if (conversation === undefined || conversation.kind !== 'dm') return true
  const other = otherParticipants(conversation, me.member.id)[0]
  const entry = directory.get().find((candidate) => candidate.member.id === other)
  return entry === undefined || entry.canMessage
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
  const inView = new Set<Element>()
  let waitingForThePerson = openedForThePerson.get() === id
  const report = (element: Element): void => {
    const note = noteById(id, (element as HTMLElement).dataset.noteId ?? null)
    if (note === null || reported.has(note.id) || !isUnreadBy(note, me.member.id)) return
    reported.add(note.id)
    launch(markRead(note))
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) inView.add(entry.target)
        else inView.delete(entry.target)
      if (document.visibilityState !== 'visible' || waitingForThePerson) return
      for (const entry of entries) if (entry.isIntersecting) report(entry.target)
    },
    { root: scroller, threshold: 0.6 },
  )
  const personActed = (): void => {
    if (!waitingForThePerson) return
    waitingForThePerson = false
    openedForThePerson.set(null)
    for (const element of inView) report(element)
  }
  for (const kind of PERSON_ACTIONS) document.addEventListener(kind, personActed, { passive: true })
  life.add(() => {
    observer.disconnect()
    for (const kind of PERSON_ACTIONS) document.removeEventListener(kind, personActed)
    if (openedForThePerson.get() === id) openedForThePerson.set(null)
  })
  return {
    watch: (element: HTMLElement): HTMLElement => {
      if (element.dataset.unread === 'true') observer.observe(element)
      return element
    },
  }
}

const PERSON_ACTIONS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

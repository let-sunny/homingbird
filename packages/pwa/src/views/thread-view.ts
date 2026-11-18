import { systemClock } from '@homingbird/kernel'
import {
  type Channel,
  type Conversation,
  type ConversationId,
  type Me,
  type MemberId,
  type Note,
  summarize,
} from '@homingbird/protocol'
import type { StateName } from '@homingbird/sprites'
import { type Child, type Lifetime, h, keyedRegion, linkedText, region, signal } from '@homingbird/ui'
import {
  approveDraft,
  askAgent,
  discardDraft,
  launch,
  loadChannels,
  loadOlderNotes,
  loadPeople,
  loadThread,
  markRead,
  replyTargetIn,
  saveDraft,
  sendNote,
  withdrawRequest,
} from '../actions.ts'
import { channelLabel, channelOfRoom } from '../channels.ts'
import { characterOf } from '../characters.ts'
import { type DraftBasis, draftBasisOf } from '../draft-basis.ts'
import { waitingRequests } from '../draft-requests.ts'
import { MISSING, orMissing } from '../missing.ts'
import { changedItems, showsNewerBelow, unseenAfterDraw } from '../newer-below.ts'
import { hrefFor } from '../routes.ts'
import { spriteOwner } from '../sprite-owner.ts'
import {
  archiveDiscards,
  channels,
  conversations,
  directory,
  draftRequests,
  members,
  openedForThePerson,
  releases,
  replyTargets,
  sendingIn,
  threads,
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
import { agentAsk } from './agent-ask.ts'
import { privateMark, roomControls, rosters } from './channel-membership.ts'
import { moveForm, readdressForm } from './channel-picker.ts'
import { groupAvatar, memberAvatar } from './character-avatar.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import {
  archivedMark,
  backLink,
  button,
  channelCounts,
  emptyWithPip,
  presenceBadges,
  timeLabel,
} from './parts.ts'
import { pip } from './pip.ts'

export const threadView = (life: Lifetime, me: Me, id: ConversationId): HTMLElement => {
  const missing = signal(false)
  launch(orMissing(loadThread(id)), (found) => missing.set(found === MISSING))
  launch(loadPeople)
  launch(loadChannels(''))
  const scroller = h('div', { class: 'thread-scroll', tabindex: '0' })
  const list = h('ol', { class: 'notes', 'aria-live': 'polite', 'aria-relevant': 'additions' })
  const newerBelow = h(
    'button',
    { type: 'button', class: 'newer-below', hidden: true },
    `↓ ${strings.newerBelow}`,
  )
  const signatureOf = (item: ThreadItem): string =>
    JSON.stringify([item, peopleIn(item, me), roomState(id), replyTargetIn(id)])
  const follow = followNewNotes(life, scroller, newerBelow, () =>
    threadItems(notesIn(id), draftRequests.get()).map((item) => [item.key, signatureOf(item)] as const),
  )
  const seen = markReadWhenSeen(life, scroller, me, id)

  keyedRegion(
    life,
    list,
    [threads, members, replyTargets, draftRequests, channels, conversations, releases],
    () => threadItems(notesIn(id), draftRequests.get()),
    {
      key: (item) => item.key,
      signature: signatureOf,
      render: (item) =>
        follow.track(
          item.key,
          seen.watch(item.type === 'note' ? noteItem(item, me, id) : draftsItem(item, me, id)),
        ),
    },
  )
  life.add(threads.subscribe(follow.afterDraw))
  life.add(channels.subscribe(follow.afterDraw))
  life.add(members.subscribe(follow.afterDraw))

  scroller.append(
    region(life, [threads], () => {
      const thread = threads.get().get(id)
      if (thread === undefined) return h('p', { class: 'loading' }, strings.loading)
      if (thread.hasMore)
        return button(strings.loadOlder, () => launch(loadOlderNotes(id)), { class: 'load-older' })
      return (
        thread.notes.length === 0 &&
        emptyWithPip(
          'waving',
          4,
          roomOf(id)?.kind === 'channel' ? strings.channelRoomEmpty : strings.emptyThread,
        )
      )
    }),
    list,
    region(life, [archiveDiscards], () =>
      (archiveDiscards.get().get(id) ?? []).map((discard) =>
        h(
          'p',
          { class: 'released archive-discard', role: 'status', data: { noteId: discard.noteId } },
          pip('discarded', 1),
          h('span', {}, strings.draftDiscardedByArchive({ channel: channelLabel(discard.channel) })),
        ),
      ),
    ),
  )
  const thread = h(
    'section',
    { class: 'thread' },
    threadHead(life, me, id),
    scroller,
    newerBelow,
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
  const channel = channelOfRoom(channels.get(), id)
  return [room?.kind, room?.archivedAt ?? null, channel, [...releases.get()]]
}

const spriteOf = (memberId: MemberId, state: StateName): HTMLElement =>
  memberAvatar(memberOf(spriteOwner({ kind: 'note', authorId: memberId }) as MemberId), {
    state,
    labelled: false,
  })

const threadHead = (life: Lifetime, me: Me, id: ConversationId): HTMLElement =>
  region(
    life,
    [conversations, members, directory, channels, rosters],
    () => {
      const conversation = roomOf(id)
      if (conversation === undefined) return [backLink(), h('h1', {}, strings.loading)]
      const title = conversationTitle(conversation, members.get(), me.member.id, strings.formerMember)
      if (conversation.kind === 'channel' || isArchived(conversation)) return channelHead(conversation, title)
      const others = otherParticipants(conversation, me.member.id)
      const entry = directory.get().find((candidate) => candidate.member.id === others[0])
      const people = others.map((other) => memberOf(other))
      return [
        backLink(),
        conversation.kind !== 'direct' && people.length > 1
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
          conversation.kind === 'direct' &&
            entry !== undefined &&
            h('p', { class: 'thread-profile' }, entry.member.profile),
        ),
        conversation.kind === 'direct' && entry !== undefined && presenceBadges(entry.presence, true),
      ]
    },
    { class: 'thread-head' },
  )

const channelHead = (conversation: Conversation, title: string): Child => {
  const archived = isArchived(conversation)
  const channel = archived ? null : channelOfRoom(channels.get(), conversation.id)
  return [
    backLink(),
    h('span', { class: 'avatar is-channel', 'aria-hidden': 'true' }, '#'),
    h(
      'div',
      { class: 'thread-who' },
      h('h1', {}, title, channel !== null && privateMark(channel), archived && archivedMark()),
      channel !== null &&
        h(
          'div',
          { class: 'thread-profile channel-head-meta' },
          channelCounts(channel),
          h('span', { class: 'channel-head-description' }, channel.description),
        ),
    ),
    channel !== null && roomControls(channel),
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
  const isChannelQuestion = room?.kind === 'channel' && note.inReplyTo === null
  const answerers = isChannelQuestion ? answeredBy(note) : []
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
      mine && sentNoteBasis(draftBasisOf(note)),
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
        isChannelQuestion &&
          !archived &&
          isOpenQuestion(note, notesIn(conversationId)) &&
          h(
            'button',
            {
              type: 'button',
              class: 'link move-question',
              ...opensDialog(strings.moveTitle, (life) => moveForm(life, note, conversationId)),
            },
            strings.moveToChannel,
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
  const channel = room?.kind === 'channel' ? channelOfRoom(channels.get(), conversationId) : null
  const question = channel !== null && item.inReplyTo === null
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
      item.drafts.map((draft) => draftCard(draft, item, me, room, archived, question ? channel : null)),
    ),
  )
}

const draftCard = (
  draft: Note,
  item: Extract<ThreadItem, { type: 'drafts' }>,
  me: Me,
  room: Conversation | undefined,
  archived: boolean,
  channel: Channel | null,
): HTMLElement =>
  h(
    'article',
    { class: 'draft', data: { draftId: draft.id } },
    originBadge(draft),
    h('p', { class: 'note-body' }, linkedText(draft.body)),
    draftBasisBlock(draftBasisOf(draft)),
    !archived && room !== undefined && destinationLine(draft, me, room, channel),
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
        channel !== null &&
          h(
            'button',
            {
              type: 'button',
              class: 'change-channel',
              ...opensDialog(strings.changeChannel, (life) => readdressForm(life, draft, channel.slug)),
            },
            strings.changeChannel,
          ),
        button(strings.discard, () => launch(discardDraft(draft), undefined, 'draft'), { class: 'danger' }),
      ),
  )

const draftBasisBlock = (basis: DraftBasis | null): HTMLElement | null =>
  basis === null
    ? null
    : h(
        'section',
        { class: 'draft-basis', 'aria-label': strings.draftBasisTitle },
        h('h3', {}, strings.draftBasisTitle),
        ...basisLines(basis),
      )

const sentNoteBasis = (basis: DraftBasis | null): HTMLElement | null =>
  basis === null || basis.kind === 'none'
    ? null
    : h('details', { class: 'note-basis' }, h('summary', {}, strings.draftBasisTitle), ...basisLines(basis))

const basisLines = (basis: DraftBasis): HTMLElement[] =>
  basis.kind === 'none'
    ? [h('p', { class: 'basis-missing' }, strings.draftBasisMissing)]
    : basis.lines.map((line) => h('p', {}, linkedText(line)))

const destinationLine = (draft: Note, me: Me, room: Conversation, channel: Channel | null): HTMLElement => {
  const destination = draftDestination(room, draft, notesIn(room.id), me.member.id)
  const names = listOf(destination.memberIds.map(nameOf))
  return h(
    'p',
    { class: 'draft-destination' },
    channel !== null
      ? [
          h('span', {}, strings.sendsToChannel({ channel: channelLabel(channel.slug) })),
          channelCounts(channel),
        ]
      : room.kind === 'channel'
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
  if (conversation === undefined || conversation.kind !== 'direct') return true
  const other = otherParticipants(conversation, me.member.id)[0]
  const entry = directory.get().find((candidate) => candidate.member.id === other)
  return entry === undefined || entry.canMessage
}

const NEAR_BOTTOM_PX = 120

/**
 * Keeps the view at the bottom while the person is there, and otherwise points at what arrived or
 * changed below that they have not seen; unread notes below count on opening.
 */
const followNewNotes = (
  life: Lifetime,
  scroller: HTMLElement,
  indicator: HTMLButtonElement,
  signatures: () => ReadonlyArray<readonly [string, string]>,
) => {
  let pinned = true
  let drawn = new Map<string, string>()
  let unseen = new Set<string>()
  const elements = new Map<string, HTMLElement>()
  const inView = new Set<string>()
  const keyOf = (element: Element): string => (element as HTMLElement).dataset.itemKey ?? ''
  const update = (): void => {
    const order = [...elements.keys()]
    indicator.hidden = !showsNewerBelow({ order, unseen, inView, atBottom: pinned })
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          inView.add(keyOf(entry.target))
          unseen.delete(keyOf(entry.target))
        } else inView.delete(keyOf(entry.target))
      update()
    },
    { root: scroller, threshold: 0.6 },
  )
  const onScroll = (): void => {
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX
    if (pinned) unseen = new Set()
    update()
  }
  scroller.addEventListener('scroll', onScroll, { passive: true })
  indicator.addEventListener('click', () => scroller.scrollTo({ top: scroller.scrollHeight }))
  life.add(() => {
    scroller.removeEventListener('scroll', onScroll)
    observer.disconnect()
  })
  return {
    track: (key: string, element: HTMLElement): HTMLElement => {
      element.dataset.itemKey = key
      const known = elements.get(key)
      if (known !== undefined) observer.unobserve(known)
      elements.set(key, element)
      if (drawn.size === 0 && element.dataset.unread === 'true') unseen.add(key)
      observer.observe(element)
      return element
    },
    afterDraw: (): void => {
      const now = new Map(signatures())
      for (const key of [...elements.keys()]) if (!now.has(key)) elements.delete(key)
      if (drawn.size > 0) unseen = unseenAfterDraw(unseen, changedItems(drawn, now), pinned)
      drawn = now
      if (pinned) requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight }))
      update()
    },
  }
}

const markReadWhenSeen = (life: Lifetime, scroller: HTMLElement, me: Me, id: ConversationId) => {
  const reported = new Set<string>()
  const inView = new Set<Element>()
  let waitingForThePerson = openedForThePerson.get() === id
  if (waitingForThePerson) scroller.dataset.reading = 'waiting-for-the-person'
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
  const personActed = (event: Event): void => {
    if (!waitingForThePerson || !event.isTrusted) return
    waitingForThePerson = false
    delete scroller.dataset.reading
    openedForThePerson.set(null)
    for (const element of inView) report(element)
  }
  for (const kind of PERSON_ACTIONS) document.addEventListener(kind, personActed, { passive: true })
  life.add(() => {
    observer.disconnect()
    for (const kind of PERSON_ACTIONS) document.removeEventListener(kind, personActed)
  })
  return {
    watch: (element: HTMLElement): HTMLElement => {
      if (element.dataset.unread === 'true') observer.observe(element)
      return element
    },
  }
}

const PERSON_ACTIONS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

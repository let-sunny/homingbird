import { Task as T, systemClock } from '@homingbird/kernel'
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
  refreshAgentReport,
  refreshPrinciples,
  replyTargetIn,
  reportDraftSeen,
  saveDraft,
  sendNote,
  withdrawRequest,
} from '../actions.ts'
import { authorshipOf, showsStateMark, stateMarkOf } from '../authorship.ts'
import { approvesQuicklyOften, carefulReadingFor } from '../careful-reading.ts'
import { channelLabel, channelOfRoom } from '../channels.ts'
import { characterOf } from '../characters.ts'
import { type DraftBasis, draftBasisOf } from '../draft-basis.ts'
import { waitingRequests } from '../draft-requests.ts'
import { featureOn } from '../features.ts'
import { MISSING, orMissing } from '../missing.ts'
import { changedItems, showsNewerBelow, unseenAfterDraw } from '../newer-below.ts'
import { hrefFor } from '../routes.ts'
import { spriteOwner } from '../sprite-owner.ts'
import {
  agentReport,
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
  serverInfo,
  taught,
  threads,
} from '../state.ts'
import { formats, listOf, strings } from '../strings.ts'
import {
  type SingleStatus,
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
import { appliedMarkers, chancesIn } from './teaching.ts'

export const threadView = (life: Lifetime, me: Me, id: ConversationId): HTMLElement => {
  const missing = signal(false)
  launch(orMissing(loadThread(id)), (found) => missing.set(found === MISSING))
  launch(loadPeople)
  launch(loadChannels(''))
  if (featureOn('teaching') && taught.get() === null) launch(refreshPrinciples)
  if (featureOn('agentFigures')) launch(refreshAgentReport)
  const scroller = h('div', { class: 'thread-scroll', tabindex: '0' })
  const list = h('ol', { class: 'notes', 'aria-live': 'polite', 'aria-relevant': 'additions' })
  const newerBelow = h(
    'button',
    { type: 'button', class: 'newer-below', hidden: true },
    `↓ ${strings.newerBelow}`,
  )
  const signatureOf = (item: ThreadItem): string =>
    JSON.stringify([
      item,
      peopleIn(item, me),
      roomState(id),
      replyTargetIn(id),
      taughtTitles(),
      approvesQuicklyOften(agentReport.get()),
      showsNoteDetails(),
    ])
  const follow = followNewNotes(life, scroller, newerBelow, () =>
    threadItems(notesIn(id), draftRequests.get()).map((item) => [item.key, signatureOf(item)] as const),
  )
  const seen = markReadWhenSeen(life, scroller, me, id)

  keyedRegion(
    life,
    list,
    [
      threads,
      members,
      replyTargets,
      draftRequests,
      channels,
      conversations,
      releases,
      taught,
      agentReport,
      serverInfo,
    ],
    () => threadItems(notesIn(id), draftRequests.get()),
    {
      key: (item) => item.key,
      signature: signatureOf,
      render: (item) =>
        follow.track(
          item.key,
          seen.watch(item.type === 'note' ? noteItem(life, item, me, id) : draftsItem(item, me, id)),
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
    featureOn('teaching') && chancesIn(life, id),
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

const carefulLine = (draft: Note): HTMLElement | null => {
  const reason = carefulReadingFor(draft.body, approvesQuicklyOften(agentReport.get()))
  return reason === null
    ? null
    : h('p', { class: 'careful-reading', role: 'note' }, strings.carefulReading[reason])
}

const taughtTitles = (): string => {
  const loaded = taught.get()
  return loaded === null || loaded === 'failed'
    ? ''
    : loaded.principles.map((principle) => principle.topic).join(';')
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
  life: Lifetime,
  item: Extract<ThreadItem, { type: 'note' }>,
  me: Me,
  conversationId: ConversationId,
): HTMLElement => {
  const { note, leadsRun, next } = item
  const mine = note.authorId === me.member.id
  const quoted = noteById(conversationId, note.inReplyTo)
  const room = roomOf(conversationId)
  const archived = isArchived(room)
  const inRoom = showsAuthors(room)
  const isChannelQuestion = room?.kind === 'channel' && note.inReplyTo === null
  const answerers = isChannelQuestion ? answeredBy(note) : []
  const sentAt = note.sentAt === null ? null : formats.full.format(new Date(note.sentAt))
  const actions = [
    !mine &&
      !archived &&
      button(
        strings.reply,
        () => replyTargets.update((targets) => new Map(targets).set(conversationId, note.id)),
        { class: 'link' },
      ),
    !mine &&
      !archived &&
      featureOn('draftRequests') &&
      button(
        strings.askAgentToReply,
        () => launch(askAgent({ destination: { inReplyTo: note.id }, instruction: '', agentId: null })),
        { class: 'link ask-reply' },
      ),
    isChannelQuestion &&
      !archived &&
      featureOn('channels') &&
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
  ].filter((action): action is HTMLButtonElement => action !== false)
  const li = h(
    'li',
    {
      class: `note ${mine ? 'is-mine' : 'is-theirs'} ${leadsRun ? 'leads-run' : 'follows-run'} is-${authorshipOf(note)}`,
      data: { noteId: note.id, unread: String(isUnreadBy(note, me.member.id)) },
    },
    h('span', { class: 'note-face' }, leadsRun && authorButton(life, note, mine, sentAt)),
    h(
      'div',
      { class: 'note-column' },
      !leadsRun && h('span', { class: 'visually-hidden' }, authorshipLine(note, mine)),
      sentAt !== null && h('span', { class: 'visually-hidden' }, strings.authorship.sent({ time: sentAt })),
      inRoom && leadsRun && h('span', { class: 'note-author' }, mine ? strings.you : nameOf(note.authorId)),
      h(
        'div',
        { class: 'bubble', ...(next !== null && sentAt !== null && { title: sentAt }) },
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
      (next === null || (mine && showsStateMark(note, next))) &&
        h(
          'div',
          { class: 'note-meta' },
          next === null &&
            note.sentAt !== null &&
            h('span', { 'aria-hidden': 'true' }, timeLabel(note.sentAt)),
          mine && showsStateMark(note, next) && stateMark(note, inRoom),
        ),
      actions.length > 0 && h('div', { class: 'note-actions' }, actions),
    ),
  )
  if (document.querySelector(`.notes .is-active[data-note-id="${note.id}"]`) !== null)
    li.classList.add('is-active')
  li.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a, button, .author-details') !== null) return
    for (const other of li.parentElement?.querySelectorAll('.note.is-active') ?? [])
      if (other !== li) other.classList.remove('is-active')
    li.classList.toggle('is-active')
  })
  return li
}

/** The author's character as a button: a mark when an agent wrote the note, and the details on hover, tap or Enter. */
const authorButton = (life: Lifetime, note: Note, mine: boolean, sentAt: string | null): HTMLElement => {
  const id = `author-${note.id}`
  const details = h(
    'div',
    { id, class: 'author-details', popover: POPOVER_KIND, role: 'note' },
    h('p', { class: 'author-line' }, authorshipLine(note, mine)),
    showsNoteDetails() &&
      note.origin !== 'human' && [
        h(
          'p',
          {},
          note.agentModel == null
            ? strings.authorship.modelNotStated
            : strings.authorship.model({ model: note.agentModel }),
        ),
        h(
          'p',
          {},
          note.agentClient == null
            ? strings.authorship.clientUnknown
            : strings.authorship.client({ client: note.agentClient }),
        ),
        note.agentName !== null && h('p', {}, strings.authorship.connection({ name: note.agentName })),
        h('p', { class: 'author-reported' }, strings.authorship.reported),
      ],
    showsNoteDetails() &&
      sentAt !== null &&
      h('p', { class: 'author-sent' }, strings.authorship.sent({ time: sentAt })),
  )
  const trigger = h(
    'button',
    {
      type: 'button',
      class: `author-button is-${authorshipOf(note)}`,
      popovertarget: id,
      'aria-label': strings.authorship.who({ authorship: authorshipLine(note, mine) }),
    },
    memberAvatar(memberOf(spriteOwner({ kind: 'note', authorId: note.authorId }) as MemberId), {
      labelled: false,
    }),
    note.origin !== 'human' && h('span', { class: 'author-mark', 'aria-hidden': 'true' }),
  )
  opensOnHover(life, trigger, details)
  keepsOpenAcrossRedraw(id, trigger, details)
  return h('span', { class: 'author' }, trigger, details)
}

/**
 * Opening the details counts as the person acting, which marks the note read and redraws it. The
 * redrawn note keeps the details open and the focus where the person left them.
 */
const keepsOpenAcrossRedraw = (id: string, trigger: HTMLElement, details: HTMLElement): void => {
  const before = document.getElementById(id)
  if (before === null) return
  const wasOpen = hasPopover(before) ? before.matches(':popover-open') : !before.hidden
  const hadFocus = before.parentElement?.contains(document.activeElement) ?? false
  queueMicrotask(() => {
    if (!details.isConnected) return
    if (wasOpen && hasPopover(details)) details.showPopover()
    else if (wasOpen) trigger.click()
    if (hadFocus) trigger.focus()
  })
}

const hasPopover = (element: HTMLElement): boolean =>
  typeof (element as { showPopover?: unknown }).showPopover === 'function'

/** Whether this organization shows what wrote an agent's note; the server leaves the details out when not. */
const showsNoteDetails = (): boolean => featureOn('noteDetails')

const authorshipLine = (note: Note, mine: boolean): string => {
  const kind = authorshipOf(note)
  const name = nameOf(note.authorId)
  switch (kind) {
    case 'agent':
      return mine ? strings.authorship.agentYou : strings.authorship.agent({ name })
    case 'edited':
      return mine ? strings.authorship.editedYou : strings.authorship.edited({ name })
    case 'person':
      return mine ? strings.authorship.personYou : strings.authorship.person({ name })
  }
}

/**
 * Hover opens the details after a short pause and keeps them open while the pointer is over either; a
 * click or Enter keeps them open until Escape or a click elsewhere. Hover uses a `hint` popover, which
 * leaves other open popovers alone; without one, a manual popover closes itself the same way.
 */
const opensOnHover = (life: Lifetime, trigger: HTMLElement, details: HTMLElement): void => {
  if (!hasPopover(details)) {
    closesLikeAPopover(trigger, details)
    return
  }
  trigger.style.setProperty('anchor-name', `--${details.id}`)
  details.style.setProperty('position-anchor', `--${details.id}`)
  let pending: T.RunningTask<void, never> | undefined
  let openedByHover = false
  const later = (action: () => void, ms: number): void => {
    void pending?.interrupt()
    pending = T.runFork(T.map(() => action())(T.sleep(ms)), { clock: systemClock })
  }
  life.add(() => void pending?.interrupt())
  const isOpen = (): boolean => details.matches(':popover-open')
  trigger.addEventListener('click', (event) => {
    if (!openedByHover || !isOpen()) return
    event.preventDefault()
    openedByHover = false
  })
  details.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed') openedByHover = false
  })
  if (POPOVER_KIND === 'manual') closesWhenDismissed(trigger, details)
  for (const element of [trigger, details]) {
    element.addEventListener('pointerenter', (event) => {
      if ((event as PointerEvent).pointerType !== 'mouse') return
      later(() => {
        if (isOpen() || !details.isConnected) return
        details.showPopover()
        openedByHover = true
      }, HOVER_OPEN_MS)
    })
    element.addEventListener('pointerleave', (event) => {
      if ((event as PointerEvent).pointerType !== 'mouse') return
      later(() => {
        if (isOpen() && openedByHover) details.hidePopover()
      }, HOVER_CLOSE_MS)
    })
  }
}

/** A manual popover has no light dismiss of its own: Escape or a press elsewhere closes it while it is open. */
const closesWhenDismissed = (trigger: HTMLElement, details: HTMLElement): void => {
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    details.hidePopover()
    if (details.contains(document.activeElement)) trigger.focus()
  }
  const onPress = (event: Event): void => {
    const target = event.target as Node
    if (!details.contains(target) && !trigger.contains(target)) details.hidePopover()
  }
  details.addEventListener('toggle', (event) => {
    const open = (event as ToggleEvent).newState === 'open'
    for (const [kind, listener] of [
      ['keydown', onKey],
      ['pointerdown', onPress],
    ] as const)
      if (open) document.addEventListener(kind, listener as EventListener)
      else document.removeEventListener(kind, listener as EventListener)
  })
}

/** `hint` where the browser knows it, so hovering never closes another popover; `manual` otherwise. */
const POPOVER_KIND: 'hint' | 'manual' = (() => {
  const probe = document.createElement('div')
  probe.setAttribute('popover', 'hint')
  return (probe as { popover?: unknown }).popover === 'hint' ? 'hint' : 'manual'
})()

/** Without `popover`, a click toggles the details; Escape, or focus moving elsewhere, closes them. */
const closesLikeAPopover = (trigger: HTMLElement, details: HTMLElement): void => {
  const show = (open: boolean): void => {
    details.hidden = !open
    trigger.setAttribute('aria-expanded', String(open))
  }
  show(false)
  trigger.addEventListener('click', () => show(details.hidden))
  for (const element of [trigger, details]) {
    element.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape' || details.hidden) return
      show(false)
      trigger.focus()
    })
    element.addEventListener('focusout', (event) => {
      const next = (event as FocusEvent).relatedTarget as Node | null
      if (next === null || !(trigger.contains(next) || details.contains(next))) show(false)
    })
  }
}

const HOVER_OPEN_MS = 350
const HOVER_CLOSE_MS = 250

const stateMark = (note: Note, inRoom: boolean): HTMLElement => {
  const mark = stateMarkOf(note.receipts)
  return h(
    'span',
    {
      class: `state-mark is-${mark.state}`,
      role: 'img',
      'aria-label': inRoom ? roomStatus(note) : dmStatus(note),
      title: inRoom ? roomStatus(note) : dmStatus(note),
      data: { state: mark.state },
    },
    h(
      'span',
      { class: 'state-glyph', 'aria-hidden': 'true' },
      `${STATE_GLYPHS[mark.state]}${TEXT_PRESENTATION}`,
    ),
    mark.count !== null &&
      h(
        'span',
        { class: 'state-count', 'aria-hidden': 'true' },
        strings.readCount({
          read: formats.decimal.format(mark.count.read),
          of: formats.decimal.format(mark.count.of),
        }),
      ),
  )
}

/** Asks for the text form of a glyph, so that no platform swaps in a coloured emoji. */
const TEXT_PRESENTATION = '\uFE0E'

const STATE_GLYPHS: Readonly<Record<SingleStatus, string>> = {
  sent: '·',
  delivered: '✓',
  read: '✓✓',
  drafting: '✎',
  replied: '↩',
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
    featureOn('draftRequests') &&
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
): HTMLElement => {
  const card = draftCardContent(draft, item, me, room, archived, channel)
  reportDraftSeen(card, draft.id)
  return card
}

const draftCardContent = (
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
    featureOn('teaching') && appliedMarkers(draft),
    !archived && room !== undefined && destinationLine(draft, me, room, channel),
    !archived && featureOn('agentFigures') && carefulLine(draft),
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
    featureOn('draftRequests') &&
      agentAsk(life, () => {
        const inReplyTo = replyTargetIn(id)
        return inReplyTo === null ? { conversationId: id } : { inReplyTo }
      }),
  )
}

const waitingChips = (me: Me, id: ConversationId): Child => {
  if (!featureOn('draftRequests')) return null
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
        h('a', { href: hrefFor({ name: 'agent', section: 'connection' }) }, strings.connectAgent),
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

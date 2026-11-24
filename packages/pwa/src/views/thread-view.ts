import type { AsRead, ConversationId, MemberId, NoteId } from '@homingbird/protocol'
import { type Lifetime, h, keyedRegion, region, signal, slice } from '@homingbird/ui'
import { approvesQuicklyOften } from '../careful-reading.ts'
import { channelOfRoom } from '../channels.ts'
import { characterOf } from '../characters.ts'
import { featureOn } from '../features.ts'
import { type HeldLine, heldLineFor } from '../held-decisions.ts'
import { MISSING } from '../missing.ts'
import { type RoomReview, reviewsInRoomModel } from '../models/channel-agent.ts'
import { type ComposerModel, composerModel } from '../models/composer.ts'
import { draftPreviewsModel } from '../models/draft-previews.ts'
import { draftsItemModel } from '../models/drafts-item.ts'
import { noteItemModel } from '../models/note-item.ts'
import { type ThreadDivider, firstUnreadIn, withDividers } from '../models/thread-dividers.ts'
import {
  type ThreadInput,
  archiveDiscardLines,
  isFocusedDraftOpen,
  noteIn,
  roomOf,
  settledDraftLine,
  threadHeadModel,
  threadNotesLabel,
  threadTopModel,
} from '../models/thread-room.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { replyTargetIn } from '../tasks/notes.ts'
import { type ThreadItem, hasDraftWaiting, threadItems } from '../thread.ts'
import { reviewCard } from './channel-agent.ts'
import { composer } from './composer.ts'
import type { ViewContext } from './context.ts'
import { renderDraftPreviews } from './draft-previews.ts'
import { renderDraftsItem, reportWhenSeen } from './drafts-item.ts'
import { renderHeldLine } from './held-toast.ts'
import { renderNoteItem } from './note-item.ts'
import { button, emptyWithPip, loading } from './parts.ts'
import { chancesIn } from './teaching.ts'
import { renderThreadHead } from './thread-head.ts'
import { followNewNotes, markReadWhenSeen } from './thread-scroll.ts'

/**
 * A conversation: its head, its notes and drafts as they come with a heading for each day and a line
 * over what was unread on opening, the answers of a channel's agent the person reviews under their
 * questions, the chances to teach, and the composer. A link may name a draft, an answer to review or a
 * sent note to open the conversation at; otherwise the composer takes the focus where there is a
 * keyboard.
 */
export const threadView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  id: ConversationId,
  focusedDraft: string | null,
  focusedReview: string | null = null,
  focusedNote: string | null = null,
): HTMLElement => {
  const { state, actions } = context
  const missing = signal(false)
  let focusedDraftShownOpen = false
  actions.openThread(id, { done: (found) => missing.set(found === MISSING) })
  actions.loadPeople()
  actions.loadKnownChannels()
  if (featureOn('teaching', state.serverInfo.get()) && state.taught.get() === null)
    actions.refreshPrinciples()
  if (featureOn('agentFigures', state.serverInfo.get())) actions.refreshAgentReport()
  if (focusedReview !== null && featureOn('channelAgents', state.serverInfo.get())) actions.refreshReviews()
  if (featureOn('draftPreviews', state.serverInfo.get())) {
    actions.loadPreviews(id)
    if (state.previewAllowance.get() === null) actions.loadPreviewAllowance()
  }
  const input = (): ThreadInput => ({
    me,
    conversationId: id,
    thread: state.threads.get().get(id),
    draftsRead: state.draftsRead.get(),
    draftEdits: state.draftEdits.get(),
    conversations: state.conversations.get(),
    channels: state.channels.get(),
    members: state.members.get(),
    directory: state.directory.get(),
    releases: state.releases.get(),
    archiveDiscards: state.archiveDiscards.get().get(id) ?? [],
    discardedAnswers: state.discardedAnswers.get(),
    replyTarget: replyTargetIn(state, id),
    draftRequests: state.draftRequests.get(),
    taught: state.taught.get(),
    agentReport: state.agentReport.get(),
    serverInfo: state.serverInfo.get(),
    sending: state.sendingIn.get().has(id),
    now: context.clock.now(),
    focusedDraft,
    previewedBodies: state.previewedBodies.get(),
  })
  let unreadFrom: NoteId | null | undefined
  const unreadOnOpening = (): NoteId | null => {
    const thread = state.threads.get().get(id)
    if (unreadFrom === undefined && thread !== undefined)
      unreadFrom = firstUnreadIn(thread.notes, me.member.id)
    return unreadFrom ?? null
  }
  const items = (): ReadonlyArray<ShownItem> =>
    withDividers(
      reviewsInRoomModel(
        threadItems(state.threads.get().get(id)?.notes ?? [], state.draftRequests.get()),
        state.reviews.get(),
        { conversationId: id, viewerId: me.member.id },
        state.reviewsRead.get(),
        state.members.get(),
        state.draftEdits.get(),
        focusedReview,
        state.channels.get(),
      ).map((item): RoomItem => {
        const line = item.type === 'note' ? null : heldLineFor(state.held.get(), decidedBy(item))
        return line === null ? item : { type: 'held', key: item.key, line }
      }),
      { now: context.clock.now(), unreadFrom: unreadOnOpening() },
    )
  const scroller = h('div', { class: 'thread-scroll', tabindex: '0', role: 'region' })
  const list = h('ol', { class: 'notes' })
  const newerBelow = h(
    'button',
    { type: 'button', class: 'newer-below', hidden: true },
    `↓ ${strings.newerBelow}`,
  )
  const signatureOf = (item: ShownItem): string => {
    if (item.type === 'review' || item.type === 'divider' || item.type === 'held') return JSON.stringify(item)
    const shown = input()
    const drawn = item.type === 'note' ? noteItemModel(shown, item) : item
    return JSON.stringify([drawn, ...signatureParts(shown, item)])
  }
  const follow = followNewNotes(context, life, scroller, newerBelow, () =>
    items().flatMap((item) => (item.type === 'divider' ? [] : [[item.key, signatureOf(item)] as const])),
  )
  let broughtIntoView = false
  const drafts = (item: Extract<ThreadItem, { type: 'drafts' }>): HTMLElement => {
    const model = draftsItemModel(input(), item)
    if (!broughtIntoView && model.cards.some((card) => card.focused)) {
      broughtIntoView = true
      follow.bringIntoView(() => list.querySelector<HTMLElement>(FOCUSED_DRAFT))
    }
    return renderDraftsItem(context, model)
  }
  const sentNote = (item: Extract<ThreadItem, { type: 'note' }>): HTMLElement => {
    const element = renderNoteItem(context, life, noteItemModel(input(), item), item.note, id)
    if (item.note.id !== focusedNote) return element
    element.classList.add('is-active')
    if (!broughtIntoView) {
      broughtIntoView = true
      follow.bringIntoView(() => list.querySelector<HTMLElement>(`.note[data-note-id="${item.note.id}"]`))
    }
    return element
  }
  const review = (item: RoomReview): HTMLElement => {
    if (!broughtIntoView && item.card.focused) {
      broughtIntoView = true
      follow.bringIntoView(() => list.querySelector<HTMLElement>(FOCUSED_REVIEW))
    }
    const element = reviewCard(context, item.card)
    element.classList.add('room-review')
    reportWhenSeen(context, element, item.card.review.note)
    return element
  }
  const seen = markReadWhenSeen(context, life, scroller, me.member.id, id, (noteId) =>
    noteIn(input(), noteId),
  )

  keyedRegion(
    life,
    list,
    [
      state.threads,
      state.draftsRead,
      state.members,
      state.replyTargets,
      state.draftRequests,
      state.channels,
      state.conversations,
      state.releases,
      state.taught,
      state.agentReport,
      state.serverInfo,
      state.reviews,
      state.reviewsRead,
      state.held,
      state.discardedAnswers,
      state.draftEdits,
      state.previewedBodies,
    ],
    items,
    {
      key: (item) => item.key,
      signature: signatureOf,
      render: (item) =>
        item.type === 'divider'
          ? renderDivider(item)
          : follow.track(
              item.key,
              seen.watch(
                item.type === 'note'
                  ? sentNote(item)
                  : item.type === 'drafts'
                    ? drafts(item)
                    : item.type === 'held'
                      ? renderHeldLine(context, item.line)
                      : review(item),
              ),
            ),
    },
  )
  life.add(state.threads.subscribe(follow.afterDraw))
  life.add(state.channels.subscribe(follow.afterDraw))
  life.add(state.members.subscribe(follow.afterDraw))

  const threadTop = slice([state.threads], () => threadTopModel(input()))
  const settledLine = slice([state.threads], () => {
    focusedDraftShownOpen ||= isFocusedDraftOpen(input())
    return settledDraftLine(input(), focusedDraftShownOpen)
  })
  scroller.append(
    region(life, [threadTop], () => {
      const top = threadTop.get()
      if (top.kind === 'loading') return loading()
      if (top.kind === 'older')
        return button(top.label, () => actions.loadOlderNotes(id), { class: 'load-older' })
      return top.kind === 'empty' && emptyWithPip('waving', top.text)
    }),
    region(life, [settledLine], () => {
      const settled = settledLine.get()
      return settled !== null && h('p', { class: 'hint settled-draft', role: 'status' }, settled)
    }),
    list,
    region(
      life,
      [
        state.previews,
        state.previewAllowance,
        state.threads,
        state.members,
        state.conversations,
        state.channels,
      ],
      () =>
        renderDraftPreviews(
          draftPreviewsModel({
            ...input(),
            previews: state.previews.get().get(id) ?? [],
            allowance: state.previewAllowance.get(),
          }),
        ),
      { class: 'draft-previews' },
    ),
    region(life, [state.archiveDiscards], () =>
      archiveDiscardLines(input().archiveDiscards).map((line) =>
        h(
          'p',
          { class: 'released archive-discard', role: 'status', data: { noteId: line.noteId } },
          h('span', {}, line.text),
        ),
      ),
    ),
  )
  const composerSources = [
    state.threads,
    state.replyTargets,
    state.directory,
    state.conversations,
    state.sendingIn,
    state.draftRequests,
    state.members,
  ]
  const head = slice(
    [state.conversations, state.members, state.directory, state.channels, state.rosters],
    () => threadHeadModel(input()),
  )
  const notesLabel = slice([state.conversations, state.members, state.channels], () =>
    threadNotesLabel(input()),
  )
  const nameScroller = (): void => scroller.setAttribute('aria-label', notesLabel.get())
  nameScroller()
  life.add(notesLabel.subscribe(nameScroller))
  if (
    focusedDraft === null &&
    focusedReview === null &&
    focusedNote === null &&
    !hasDraftWaiting(state.conversations.get().find((conversation) => conversation.id === id)) &&
    !context.page.isCoarsePointer()
  )
    state.composerFocus.set(id)
  const composerKind = slice([state.conversations], () => composerShape(composerModel(input())))
  const thread = h(
    'section',
    { class: 'thread' },
    region(life, [head], () => renderThreadHead(context, head.get()), { class: 'thread-head' }),
    scroller,
    newerBelow,
    featureOn('teaching', state.serverInfo.get()) && chancesIn(context, life, id),
    region(
      life,
      [composerKind],
      (drawing) =>
        composer(context, drawing, id, () => composerModel(input()), composerSources, follow.pin, input),
      { class: 'composer-host' },
    ),
  )
  return region(life, [missing], () => (missing.get() ? missingConversation() : thread), {
    class: 'thread-host',
  })
}

type RoomItem = ThreadItem | RoomReview | HeldItem

/** A draft or answer decided a moment ago, in its place until it is carried out. */
interface HeldItem {
  readonly type: 'held'
  readonly key: string
  readonly line: HeldLine
}

const decidedBy = (item: Exclude<ThreadItem | RoomReview, { type: 'note' }>): ReadonlyArray<NoteId> =>
  item.type === 'review' ? [item.card.review.note.id] : item.drafts.map((draft) => draft.id)

type ShownItem = RoomItem | ThreadDivider

const FOCUSED_DRAFT = '.draft[aria-current="true"]'
const FOCUSED_REVIEW = '.review-card[aria-current="true"]'

/** What decides which composer is built: the person writes in an open room, and may ask their agent. */
const composerShape = (model: ComposerModel): unknown =>
  model.kind === 'archived' ? model : { kind: model.kind, asksAgent: model.asksAgent }

/** A day's heading or the line over what was unread, between the notes it divides. */
const renderDivider = (divider: ThreadDivider): HTMLElement =>
  h('li', { class: `thread-divider is-${divider.kind}` }, h('span', {}, divider.text))

const missingConversation = (): HTMLElement =>
  emptyWithPip(
    'failed',
    strings.conversationMissing,
    h('a', { class: 'button', href: hrefFor({ name: 'home' }) }, strings.backHome),
  )

/** What else a thread item's drawing depends on, so that a change to any of it redraws the item. */
const signatureParts = (input: ThreadInput, item: ThreadItem): unknown[] => [
  item.type === 'drafts' ? item.drafts.map((draft) => input.draftsRead.get(draft.id) ?? null) : null,
  peopleIn(input, item),
  roomState(input),
  taughtTitles(input.taught),
  approvesQuicklyOften(input.agentReport),
  featureOn('noteDetails', input.serverInfo),
  item.type === 'note' ? (input.discardedAnswers?.get(item.note.id) ?? null) : null,
]

const peopleIn = (input: ThreadInput, item: ThreadItem): unknown[] => {
  const authors = item.type === 'note' ? [item.note.authorId] : item.drafts.map((draft) => draft.authorId)
  const room = item.type === 'note' ? [] : (roomOf(input)?.participantIds ?? [])
  const charactersOn = featureOn('characters', input.serverInfo)
  return [...authors, ...room, input.me.member.id].map((memberId: MemberId) => {
    const member = input.members.get(memberId)
    return [memberId, member?.name, characterOf(member, charactersOn).id, member?.character ?? null]
  })
}

const roomState = (input: ThreadInput): unknown[] => {
  const room = roomOf(input)
  return [
    room?.kind,
    room?.archivedAt ?? null,
    channelOfRoom(input.channels, input.conversationId),
    [...input.releases],
  ]
}

const taughtTitles = (taught: ThreadInput['taught']): string =>
  taught === null || taught === 'failed'
    ? ''
    : taught.principles.map((principle) => principle.topic).join(';')

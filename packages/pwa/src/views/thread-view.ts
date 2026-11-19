import type { AsRead, ConversationId, MemberId } from '@homingbird/protocol'
import { type Lifetime, h, keyedRegion, region, signal } from '@homingbird/ui'
import { approvesQuicklyOften } from '../careful-reading.ts'
import { channelOfRoom } from '../channels.ts'
import { characterOf } from '../characters.ts'
import { featureOn } from '../features.ts'
import { MISSING } from '../missing.ts'
import { composerModel } from '../models/composer.ts'
import { draftsItemModel } from '../models/drafts-item.ts'
import { noteItemModel } from '../models/note-item.ts'
import {
  type ThreadInput,
  archiveDiscardLines,
  noteIn,
  roomOf,
  threadHeadModel,
  threadTopModel,
} from '../models/thread-room.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { replyTargetIn } from '../tasks/notes.ts'
import { type ThreadItem, threadItems } from '../thread.ts'
import { composer } from './composer.ts'
import type { ViewContext } from './context.ts'
import { renderDraftsItem } from './drafts-item.ts'
import { renderNoteItem } from './note-item.ts'
import { button, emptyWithPip, loading } from './parts.ts'
import { chancesIn } from './teaching.ts'
import { renderThreadHead } from './thread-head.ts'
import { followNewNotes, markReadWhenSeen } from './thread-scroll.ts'

/** A conversation: its head, its notes and drafts as they come, the chances to teach, and the composer. */
export const threadView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  id: ConversationId,
): HTMLElement => {
  const { state, actions } = context
  const missing = signal(false)
  actions.openThread(id, { done: (found) => missing.set(found === MISSING) })
  actions.loadPeople()
  actions.loadKnownChannels()
  if (featureOn('teaching', state.serverInfo.get()) && state.taught.get() === null)
    actions.refreshPrinciples()
  if (featureOn('agentFigures', state.serverInfo.get())) actions.refreshAgentReport()
  const input = (): ThreadInput => ({
    me,
    conversationId: id,
    thread: state.threads.get().get(id),
    conversations: state.conversations.get(),
    channels: state.channels.get(),
    members: state.members.get(),
    directory: state.directory.get(),
    releases: state.releases.get(),
    archiveDiscards: state.archiveDiscards.get().get(id) ?? [],
    replyTarget: replyTargetIn(state, id),
    draftRequests: state.draftRequests.get(),
    taught: state.taught.get(),
    agentReport: state.agentReport.get(),
    serverInfo: state.serverInfo.get(),
    sending: state.sendingIn.get().has(id),
    now: context.clock.now(),
  })
  const items = (): ThreadItem[] =>
    threadItems(state.threads.get().get(id)?.notes ?? [], state.draftRequests.get())
  const scroller = h('div', { class: 'thread-scroll', tabindex: '0' })
  const list = h('ol', { class: 'notes', 'aria-live': 'polite', 'aria-relevant': 'additions' })
  const newerBelow = h(
    'button',
    { type: 'button', class: 'newer-below', hidden: true },
    `↓ ${strings.newerBelow}`,
  )
  const signatureOf = (item: ThreadItem): string => JSON.stringify([item, ...signatureParts(input(), item)])
  const follow = followNewNotes(context, life, scroller, newerBelow, () =>
    items().map((item) => [item.key, signatureOf(item)] as const),
  )
  const seen = markReadWhenSeen(context, life, scroller, me.member.id, id, (noteId) =>
    noteIn(input(), noteId),
  )

  keyedRegion(
    life,
    list,
    [
      state.threads,
      state.members,
      state.replyTargets,
      state.draftRequests,
      state.channels,
      state.conversations,
      state.releases,
      state.taught,
      state.agentReport,
      state.serverInfo,
    ],
    items,
    {
      key: (item) => item.key,
      signature: signatureOf,
      render: (item) =>
        follow.track(
          item.key,
          seen.watch(
            item.type === 'note'
              ? renderNoteItem(context, life, noteItemModel(input(), item), item.note, id)
              : renderDraftsItem(context, draftsItemModel(input(), item)),
          ),
        ),
    },
  )
  life.add(state.threads.subscribe(follow.afterDraw))
  life.add(state.channels.subscribe(follow.afterDraw))
  life.add(state.members.subscribe(follow.afterDraw))

  scroller.append(
    region(life, [state.threads], () => {
      const top = threadTopModel(input())
      if (top.kind === 'loading') return loading()
      if (top.kind === 'older')
        return button(top.label, () => actions.loadOlderNotes(id), { class: 'load-older' })
      return top.kind === 'empty' && emptyWithPip('waving', top.text)
    }),
    list,
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
  const thread = h(
    'section',
    { class: 'thread' },
    region(
      life,
      [state.conversations, state.members, state.directory, state.channels, state.rosters],
      () => renderThreadHead(context, threadHeadModel(input())),
      { class: 'thread-head' },
    ),
    scroller,
    newerBelow,
    featureOn('teaching', state.serverInfo.get()) && chancesIn(context, life, id),
    region(
      life,
      [state.conversations],
      () => composer(context, life, id, () => composerModel(input()), composerSources),
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
    strings.conversationMissing,
    h('a', { class: 'button', href: hrefFor({ name: 'home' }) }, strings.backHome),
  )

/** What else a thread item's drawing depends on, so that a change to any of it redraws the item. */
const signatureParts = (input: ThreadInput, item: ThreadItem): unknown[] => [
  peopleIn(input, item),
  roomState(input),
  input.replyTarget,
  taughtTitles(input.taught),
  approvesQuicklyOften(input.agentReport),
  featureOn('noteDetails', input.serverInfo),
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

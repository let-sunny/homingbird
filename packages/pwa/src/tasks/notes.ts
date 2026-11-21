import { Task as T } from '@homingbird/kernel'
import type { AsRead, ConversationId, NoteId } from '@homingbird/protocol'
import { batch } from '@homingbird/ui'
import { type Action, type App, withApp } from '../app.ts'
import { type MISSING, orMissing } from '../missing.ts'
import { type AppState, signedIn } from '../state.ts'
import { noteAwaitingReply, withNoteFiled, withoutNote } from '../thread.ts'
import { loadConversations } from './workspace.ts'

export const openThread = (id: ConversationId): Action<void | typeof MISSING> => orMissing(loadThread(id))

export const loadThread = (id: ConversationId): Action =>
  T.gen(function* () {
    const { state } = yield* T.ask<App>()
    const { conversation, page } = yield* currentSnapshot(id)
    state.conversations.update((list) => (list.some((c) => c.id === id) ? list : [conversation, ...list]))
    state.threads.update((all) => new Map(all).set(id, { notes: page.notes, hasMore: page.hasMore }))
    rememberNotices(state, id, page.notices)
  })

export const loadOlderNotes = (id: ConversationId): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    const thread = state.threads.get().get(id)
    const oldest = thread?.notes.find((note) => note.sentAt !== null)?.sentAt
    if (thread === undefined || oldest === undefined || oldest === null) return
    const page = yield* api['conversations.notes']({ params: { id }, query: { before: String(oldest) } })
    state.threads.update((all) => {
      const latest = all.get(id)?.notes ?? thread.notes
      const older = page.notes.filter((note) => !latest.some((known) => known.id === note.id))
      return new Map(all).set(id, { notes: [...older, ...latest], hasMore: page.hasMore })
    })
  })

/** Writes and sends a note in one step, as a reply to the chosen note or the one awaiting a reply. */
export const sendNote = (conversationId: ConversationId, body: string): Action =>
  withApp(({ state }) =>
    T.ensuring(
      T.sync(() =>
        state.sendingIn.update((sending) => new Set([...sending].filter((id) => id !== conversationId))),
      ),
    )(deliverNote(conversationId, body)),
  )

export const markRead = (note: AsRead.Note): Action =>
  withApp(({ api, state }) => T.map(rememberNote(state))(api['notes.read']({ params: { id: note.id } })))

export const chooseReplyTarget = (conversationId: ConversationId, noteId: NoteId | null): Action =>
  withApp(({ state }) =>
    T.sync(() => state.replyTargets.update((targets) => new Map(targets).set(conversationId, noteId))),
  )

/** The note a new note answers: the one the person chose, else the latest one waiting for their reply. */
export const replyTargetIn = (state: AppState, conversationId: ConversationId): NoteId | null => {
  const chosen = state.replyTargets.get().get(conversationId)
  if (chosen !== undefined) return chosen as NoteId | null
  const me = signedIn(state)
  const notes = state.threads.get().get(conversationId)?.notes ?? []
  const kind = state.conversations.get().find((conversation) => conversation.id === conversationId)?.kind
  return me === null || kind === 'channel' ? null : (noteAwaitingReply(notes, me.member.id)?.id ?? null)
}

/** Files a note where it belongs, counting the change for every conversation that showed it. */
export const rememberNote =
  (state: AppState) =>
  (note: AsRead.Note): void => {
    state.changes.count(note.conversationId)
    for (const [id, thread] of state.threads.get())
      if (thread.notes.some((known) => known.id === note.id)) state.changes.count(id)
    state.threads.update((all) => withNoteFiled(all, note))
  }

export const forgetNote = (state: AppState, conversationId: ConversationId, id: NoteId): void => {
  state.changes.count(conversationId)
  state.threads.update((all) => {
    const thread = all.get(conversationId)
    return thread === undefined
      ? all
      : new Map(all).set(conversationId, { ...thread, notes: withoutNote(thread.notes, id) })
  })
}

/** Keeps what the server remembered for this person, so a reload shows the same as the live event did. */
export const rememberNotices = (
  state: AppState,
  id: ConversationId,
  notices: ReadonlyArray<AsRead.Notice>,
): void => {
  state.releases.update((all) => {
    const kept = new Map(all)
    for (const notice of notices)
      if (notice.kind === 'released')
        kept.set(notice.noteId, { reason: notice.reason, agentName: notice.agentName })
    return kept
  })
  state.archiveDiscards.update((all) =>
    new Map(all).set(
      id,
      notices.flatMap((notice) =>
        notice.kind === 'channel_archived' && notice.channel !== null
          ? [{ noteId: notice.noteId, channel: notice.channel }]
          : [],
      ),
    ),
  )
}

export const forgetRelease = (state: AppState, noteId: NoteId): void =>
  state.releases.update((all) => {
    if (!all.has(noteId)) return all
    const remaining = new Map(all)
    remaining.delete(noteId)
    return remaining
  })

/**
 * A snapshot of a conversation no older than any change already applied to it: when a live event or
 * the person's own action changes it while the request is on its way, the snapshot is fetched again.
 */
const currentSnapshot = (id: ConversationId) =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    for (let attempt = 1; ; attempt++) {
      const before = state.changes.changesTo(id)
      const [conversation, page] = yield* T.all([
        api['conversations.get']({ params: { id } }),
        api['conversations.notes']({ params: { id }, query: {} }),
      ])
      if (!state.changes.changedSince(id, before) || attempt === SNAPSHOT_ATTEMPTS)
        return { conversation, page }
    }
  })

const SNAPSHOT_ATTEMPTS = 5

const deliverNote = (conversationId: ConversationId, body: string): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    state.sendingIn.update((sending) => new Set(sending).add(conversationId))
    const inReplyTo = replyTargetIn(state, conversationId)
    const draft = yield* api['drafts.create']({
      body: { body, conversationId, ...(inReplyTo !== null && { inReplyTo }) },
    })
    const sent = yield* api['drafts.send']({
      params: { id: draft.id },
      body: { expected: { body, conversationId } },
    })
    batch(() => {
      rememberNote(state)(sent)
      state.replyTargets.update((targets) => withoutKey(targets, conversationId))
    })
    yield* loadConversations
  })

const withoutKey = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  const copy = new Map(map)
  copy.delete(key)
  return copy
}

import { eventStream, httpApi } from '@homingbird/client'
import { type HasClock, Stream, Task as T, systemClock } from '@homingbird/kernel'
import { STREAM_PATHS } from '@homingbird/protocol'
import type {
  ApiError,
  Conversation,
  ConversationId,
  CredentialId,
  MemberId,
  Note,
  NoteId,
  Settings,
} from '@homingbird/protocol'
import { applyEvent } from './live.ts'
import { hrefFor } from './routes.ts'
import {
  type Branding,
  branding,
  connection,
  contacts,
  conversations,
  directory,
  notice,
  replyTargets,
  sendingIn,
  serverInfo,
  session,
  signedIn,
  threads,
} from './state.ts'
import { noteAwaitingReply, upsertNote, withoutNote } from './thread.ts'

export type Action<A = void> = T.Task<A, ApiError, HasClock>

export const api = httpApi({ serverUrl: globalThis.location?.origin ?? '', sendsCookies: true })

export const launch = (action: Action<unknown>, then?: () => void): void =>
  void T.run(action, { clock: systemClock }).then((exit) => {
    if (exit._tag === 'Ok') return then?.()
    if (exit.error._tag === 'Fail') return reportFailure(exit.error.error)
    if (exit.error._tag === 'Die') notice.set({ kind: 'error', text: String(exit.error.defect) })
  })

export const boot: Action = T.gen(function* () {
  branding.set(yield* loadBranding)
  serverInfo.set(yield* api['server.info']({}))
  const me = yield* T.result(api['me.get']({}))
  if (me._tag === 'Err') return session.set(null)
  session.set(me.value)
  yield* loadWorkspace
  followEvents()
})

export const loadWorkspace: Action = T.gen(function* () {
  const [listed, people, ties] = yield* T.all([
    api['conversations.list']({}),
    api['directory.list']({ query: {} }),
    api['contacts.list']({}),
  ])
  conversations.set(listed.conversations)
  directory.set(people.entries)
  contacts.set(ties.contacts)
})

export const loadConversations: Action = T.map((listed: { conversations: ReadonlyArray<Conversation> }) =>
  conversations.set(listed.conversations),
)(api['conversations.list']({}))

export const loadPeople: Action = T.gen(function* () {
  const [people, ties] = yield* T.all([api['directory.list']({ query: {} }), api['contacts.list']({})])
  directory.set(people.entries)
  contacts.set(ties.contacts)
})

export const loadThread = (id: ConversationId): Action =>
  T.gen(function* () {
    const [conversation, page] = yield* T.all([
      api['conversations.get']({ params: { id } }),
      api['conversations.notes']({ params: { id }, query: {} }),
    ])
    conversations.update((list) => (list.some((c) => c.id === id) ? list : [conversation, ...list]))
    threads.update((all) => new Map(all).set(id, { notes: page.notes, hasMore: page.hasMore }))
  })

export const loadOlderNotes = (id: ConversationId): Action =>
  T.gen(function* () {
    const thread = threads.get().get(id)
    const oldest = thread?.notes.find((note) => note.sentAt !== null)?.sentAt
    if (thread === undefined || oldest === undefined || oldest === null) return
    const page = yield* api['conversations.notes']({ params: { id }, query: { before: String(oldest) } })
    threads.update((all) =>
      new Map(all).set(id, { notes: [...page.notes, ...thread.notes], hasMore: page.hasMore }),
    )
  })

export const sendNote = (conversationId: ConversationId, body: string): Action =>
  T.ensuring(
    T.sync(() => sendingIn.update((sending) => new Set([...sending].filter((id) => id !== conversationId)))),
  )(deliverNote(conversationId, body))

const deliverNote = (conversationId: ConversationId, body: string): Action =>
  T.gen(function* () {
    sendingIn.update((sending) => new Set(sending).add(conversationId))
    const inReplyTo = replyTargetIn(conversationId)
    const draft = yield* api['drafts.create']({
      body: { body, conversationId, ...(inReplyTo !== null && { inReplyTo }) },
    })
    rememberNote(yield* api['drafts.send']({ params: { id: draft.id }, body: {} }))
    replyTargets.update((targets) => withoutKey(targets, conversationId))
    yield* loadConversations
  })

export const approveDraft = (draft: Note, editedBody?: string): Action =>
  T.gen(function* () {
    rememberNote(
      yield* api['drafts.send']({
        params: { id: draft.id },
        body: editedBody === undefined ? {} : { body: editedBody },
      }),
    )
    yield* loadThread(draft.conversationId)
    yield* loadConversations
  })

export const saveDraft = (draft: Note, body: string): Action =>
  T.map(rememberNote)(api['drafts.update']({ params: { id: draft.id }, body: { body } }))

export const discardDraft = (draft: Note): Action =>
  T.gen(function* () {
    yield* api['drafts.discard']({ params: { id: draft.id } })
    forgetNote(draft.conversationId, draft.id)
    yield* loadConversations
  })

export const markRead = (note: Note): Action =>
  T.map(rememberNote)(api['notes.read']({ params: { id: note.id } }))

export const openConversationWith = (memberId: MemberId): Action =>
  T.map((conversation: Conversation) => {
    conversations.update((list) =>
      list.some((c) => c.id === conversation.id) ? list : [conversation, ...list],
    )
    location.hash = hrefFor({ name: 'conversation', id: conversation.id })
  })(api['conversations.create']({ body: { participantIds: [memberId] } }))

export const requestContact = (memberId: MemberId): Action =>
  T.flatMap(() => loadPeople)(api['contacts.request']({ body: { memberId } }))

export const acceptContact = (memberId: MemberId): Action =>
  T.flatMap(() => loadPeople)(api['contacts.accept']({ params: { memberId } }))

export const removeContact = (memberId: MemberId): Action =>
  T.flatMap(() => loadPeople)(api['contacts.remove']({ params: { memberId } }))

export const blockMember = (memberId: MemberId): Action =>
  T.flatMap(() => loadPeople)(api['blocks.add']({ params: { memberId } }))

export const unblockMember = (memberId: MemberId): Action =>
  T.flatMap(() => loadPeople)(api['blocks.remove']({ params: { memberId } }))

export const updateProfile = (name: string, profile: string): Action =>
  T.gen(function* () {
    const member = yield* api['me.update']({ body: { name, profile } })
    const me = signedIn()
    if (me !== null) session.set({ ...me, member })
    yield* loadPeople
  })

export const renameCredential = (id: CredentialId, name: string): Action =>
  T.asUnit(api['credentials.rename']({ params: { id }, body: { name } }))

export const revokeCredential = (id: CredentialId): Action =>
  T.asUnit(api['credentials.revoke']({ params: { id } }))

export const saveSettings = (settings: Settings): Action =>
  T.asUnit(api['admin.settings.put']({ body: settings }))

export const signOut: Action = T.map(() => location.assign('/'))(
  T.tryPromise(
    (signal) => fetch('/auth/logout', { method: 'POST', headers: { 'x-homingbird-request': '1' }, signal }),
    (): ApiError => ({ _tag: 'Unavailable', message: 'The server could not be reached.' }),
  ),
)

export const replyTargetIn = (conversationId: ConversationId): NoteId | null => {
  const chosen = replyTargets.get().get(conversationId)
  if (chosen !== undefined) return chosen as NoteId | null
  const me = signedIn()
  const notes = threads.get().get(conversationId)?.notes ?? []
  return me === null ? null : (noteAwaitingReply(notes, me.member.id)?.id ?? null)
}

export const rememberNote = (note: Note): void =>
  threads.update((all) => {
    const thread = all.get(note.conversationId)
    if (thread === undefined) return all
    const notes =
      note.status === 'discarded' ? withoutNote(thread.notes, note.id) : upsertNote(thread.notes, note)
    return new Map(all).set(note.conversationId, { ...thread, notes })
  })

export const forgetNote = (conversationId: ConversationId, id: NoteId): void =>
  threads.update((all) => {
    const thread = all.get(conversationId)
    return thread === undefined
      ? all
      : new Map(all).set(conversationId, { ...thread, notes: withoutNote(thread.notes, id) })
  })

const loadBranding: T.Task<Branding> = T.catchAll(() => T.succeed(branding.get()))(
  T.tryPromise(
    async (signal) => {
      const loaded = (await (await fetch('/branding.json', { signal })).json()) as Partial<Branding>
      return { name: typeof loaded.name === 'string' ? loaded.name : 'Homingbird', logo: loaded.logo ?? null }
    },
    () => 'unavailable' as const,
  ),
)

const reportingConnection = async (url: string, init?: RequestInit): Promise<Response> => {
  try {
    const response = await fetch(url, init)
    connection.set(!response.ok ? 'offline' : url.includes(STREAM_PATHS.poll) ? 'polling' : 'live')
    return response
  } catch (error) {
    if (init?.signal?.aborted !== true) connection.set('offline')
    throw error
  }
}

const followEvents = (): void => {
  const events = eventStream(
    {
      serverUrl: location.origin,
      sendsCookies: true,
      clock: systemClock,
      fetch: reportingConnection,
    },
    new AbortController().signal,
  )
  globalThis.addEventListener('offline', () => connection.set('offline'))
  globalThis.addEventListener('online', () => connection.set('connecting'))
  T.runFork(
    Stream.forEach((event: Parameters<typeof applyEvent>[0]) => T.sync(() => applyEvent(event)))(events),
  )
}

const reportFailure = (error: ApiError): void => {
  if (error._tag === 'Unauthorized') return session.set(null)
  notice.set({ kind: 'error', text: error.message })
}

const withoutKey = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  const copy = new Map(map)
  copy.delete(key)
  return copy
}

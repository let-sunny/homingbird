import { eventStream, httpApi } from '@homingbird/client'
import { type HasClock, Stream, Task as T, systemClock } from '@homingbird/kernel'
import { STREAM_PATHS } from '@homingbird/protocol'
import type {
  ApiError,
  CharacterSpec,
  Conversation,
  ConversationId,
  CredentialId,
  DraftRequest,
  Locale,
  Member,
  MemberId,
  Note,
  NoteId,
  Settings,
  Topic,
  TopicMember,
  TopicVisibility,
} from '@homingbird/protocol'
import { type AgentAsk, requestBody, upsertRequest } from './draft-requests.ts'
import { preferredLanguage } from './languages.ts'
import { applyEvent } from './live.ts'
import { hrefFor } from './routes.ts'
import {
  type Branding,
  agentCredentials,
  branding,
  connection,
  contacts,
  conversations,
  directory,
  draftRequests,
  notice,
  replyTargets,
  sendingIn,
  serverInfo,
  session,
  signedIn,
  threads,
  topics,
} from './state.ts'
import { errorText, strings, useLanguage } from './strings.ts'
import { noteAwaitingReply, withNoteFiled, withoutNote } from './thread.ts'

export type Action<A = void> = T.Task<A, ApiError, HasClock>

export const api = httpApi({ serverUrl: globalThis.location?.origin ?? '', sendsCookies: true })

export const launch = <A>(action: Action<A>, then?: (value: A) => void): void =>
  void T.run(action, { clock: systemClock }).then((exit) => {
    if (exit._tag === 'Ok') return then?.(exit.value)
    if (exit.error._tag === 'Fail') return reportFailure(exit.error.error)
    if (exit.error._tag === 'Die') notice.set({ kind: 'error', text: String(exit.error.defect) })
  })

export const boot: Action = T.gen(function* () {
  branding.set(yield* loadBranding)
  serverInfo.set(yield* api['server.info']({}))
  const me = yield* T.result(api['me.get']({}))
  if (me._tag === 'Err') return session.set(null)
  useLanguage(preferredLanguage(me.value.locale, browserLanguages()))
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
  yield* loadAgents
  yield* loadTopics('')
})

export const loadAgents: Action = T.gen(function* () {
  const [asked, issued] = yield* T.all([api['draftRequests.list']({}), api['credentials.list']({})])
  draftRequests.set(asked.requests)
  agentCredentials.set(
    issued.credentials.filter((credential) => credential.kind === 'agent' && credential.revokedAt === null),
  )
})

export const askAgent = (ask: AgentAsk): Action<DraftRequest> =>
  T.map((request: DraftRequest) => {
    draftRequests.update((all) => upsertRequest(all, request))
    return request
  })(api['draftRequests.create']({ body: requestBody(ask) }))

export const withdrawRequest = (request: DraftRequest): Action =>
  T.map((cancelled: DraftRequest) => draftRequests.update((all) => upsertRequest(all, cancelled)))(
    api['draftRequests.cancel']({ params: { id: request.id } }),
  )

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

export const approveDraft = (
  draft: Note,
  editedBody?: string,
  alternatives: ReadonlyArray<Note> = [],
): Action =>
  T.gen(function* () {
    rememberNote(
      yield* api['drafts.send']({
        params: { id: draft.id },
        body: editedBody === undefined ? {} : { body: editedBody },
      }),
    )
    for (const alternative of alternatives)
      yield* T.result(api['drafts.discard']({ params: { id: alternative.id } }))
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

export const loadTopics = (query: string): Action<ReadonlyArray<Topic>> =>
  T.map((listed: { topics: ReadonlyArray<Topic> }) => {
    if (query === '') topics.set(listed.topics)
    return listed.topics
  })(api['topics.list']({ query: query === '' ? {} : { q: query } }))

export const createTopic = (slug: string, description: string, visibility: TopicVisibility): Action<Topic> =>
  T.gen(function* () {
    const created = yield* api['topics.create']({ body: { slug, description, visibility } })
    yield* afterTopicChange
    return created
  })

export const joinTopic = (slug: string, answering: boolean): Action =>
  T.flatMap(() => afterTopicChange)(api['topics.join']({ params: { slug }, body: { answering } }))

export const leaveTopic = (slug: string): Action =>
  T.flatMap(() => afterTopicChange)(api['topics.leave']({ params: { slug } }))

export const setAnswering = (slug: string, answering: boolean): Action =>
  T.flatMap(() => afterTopicChange)(
    (answering ? api['topics.answering.on'] : api['topics.answering.off'])({ params: { slug } }),
  )

export const loadTopicMembers = (slug: string): Action<ReadonlyArray<TopicMember>> =>
  T.map((listed: { members: ReadonlyArray<TopicMember> }) => listed.members)(
    api['topics.members.list']({ params: { slug } }),
  )

export const setTopicMember = (slug: string, memberId: MemberId, isMember: boolean): Action =>
  T.flatMap(() => afterTopicChange)(
    (isMember ? api['topics.members.add'] : api['topics.members.remove'])({ params: { slug, memberId } }),
  )

export const setTopicManager = (slug: string, memberId: MemberId, isManager: boolean): Action =>
  T.flatMap(() => afterTopicChange)(
    (isManager ? api['topics.managers.add'] : api['topics.managers.remove'])({ params: { slug, memberId } }),
  )

export const setTopicVisibility = (slug: string, visibility: TopicVisibility): Action =>
  T.flatMap(() => afterTopicChange)(api['topics.visibility.set']({ params: { slug }, body: { visibility } }))

export const askTopic = (slug: string, body: string): Action<ConversationId> =>
  T.gen(function* () {
    const draft = yield* api['drafts.create']({ body: { body, topic: slug } })
    yield* api['drafts.send']({ params: { id: draft.id }, body: {} })
    yield* loadConversations
    return draft.conversationId
  })

export const moveQuestion = (note: Note, slug: string): Action =>
  T.gen(function* () {
    yield* api['notes.move']({ params: { id: note.id }, body: { topic: slug } })
    forgetNote(note.conversationId, note.id)
    yield* afterTopicChange
  })

export const readdressDraft = (draft: Note, slug: string): Action =>
  T.gen(function* () {
    const moved = yield* api['drafts.update']({ params: { id: draft.id }, body: { topic: slug } })
    rememberNote(moved)
    yield* loadConversations
    location.hash = hrefFor({ name: 'conversation', id: moved.conversationId })
  })

export const reviseTopic = (slug: string, changes: { slug?: string; description?: string }): Action =>
  T.flatMap(() => afterTopicChange)(api['admin.topics.update']({ params: { slug }, body: changes }))

export const mergeTopic = (slug: string, into: string): Action =>
  T.flatMap(() => afterTopicChange)(api['admin.topics.merge']({ params: { slug }, body: { into } }))

export const removeTopic = (slug: string): Action =>
  T.flatMap(() => afterTopicChange)(api['admin.topics.remove']({ params: { slug } }))

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

export const useCharacter = (spec: CharacterSpec | null): Action =>
  T.gen(function* () {
    const member =
      spec === null ? yield* api['me.character.clear']({}) : yield* api['me.character.set']({ body: spec })
    const me = signedIn()
    if (me !== null) session.set({ ...me, member })
    yield* loadPeople
  })

export const resetMemberCharacter = (memberId: MemberId): Action<Member> =>
  T.gen(function* () {
    const member = yield* api['admin.members.resetCharacter']({ params: { id: memberId } })
    yield* loadPeople
    return member
  })

export const chooseLanguage = (chosen: Locale | null): Action =>
  T.gen(function* () {
    const member = yield* api['me.update']({ body: { locale: chosen } })
    const me = signedIn()
    useLanguage(preferredLanguage(chosen ?? undefined, browserLanguages()))
    if (me === null) return
    const { locale: _previous, ...rest } = me
    session.set({ ...rest, member, ...(chosen !== null && { locale: chosen }) })
  })

export const browserLanguages = (): ReadonlyArray<string> => globalThis.navigator?.languages ?? []

export const renameCredential = (id: CredentialId, name: string): Action =>
  T.asUnit(api['credentials.rename']({ params: { id }, body: { name } }))

export const revokeCredential = (id: CredentialId): Action =>
  T.asUnit(api['credentials.revoke']({ params: { id } }))

export const saveSettings = (settings: Settings): Action =>
  T.asUnit(api['admin.settings.put']({ body: settings }))

export const signOut: Action = T.map(() => location.assign('/'))(
  T.tryPromise(
    (signal) => fetch('/auth/logout', { method: 'POST', headers: { 'x-homingbird-request': '1' }, signal }),
    (): ApiError => ({ _tag: 'Unavailable', message: strings.serverUnreachable }),
  ),
)

export const replyTargetIn = (conversationId: ConversationId): NoteId | null => {
  const chosen = replyTargets.get().get(conversationId)
  if (chosen !== undefined) return chosen as NoteId | null
  const me = signedIn()
  const notes = threads.get().get(conversationId)?.notes ?? []
  const kind = conversations.get().find((conversation) => conversation.id === conversationId)?.kind
  return me === null || kind === 'topic' ? null : (noteAwaitingReply(notes, me.member.id)?.id ?? null)
}

export const rememberNote = (note: Note): void => threads.update((all) => withNoteFiled(all, note))

export const forgetNote = (conversationId: ConversationId, id: NoteId): void =>
  threads.update((all) => {
    const thread = all.get(conversationId)
    return thread === undefined
      ? all
      : new Map(all).set(conversationId, { ...thread, notes: withoutNote(thread.notes, id) })
  })

const afterTopicChange: Action = T.gen(function* () {
  yield* T.all([loadTopics(''), loadConversations, loadPeople])
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
  if (error._tag === 'Unauthorized') session.set(null)
  else notice.set({ kind: 'error', text: errorText(error) })
}

const withoutKey = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  const copy = new Map(map)
  copy.delete(key)
  return copy
}

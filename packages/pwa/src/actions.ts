import { eventStream, httpApi } from '@homingbird/client'
import { type HasClock, Stream, Task as T, systemClock } from '@homingbird/kernel'
import { STREAM_PATHS } from '@homingbird/protocol'
import type {
  ApiError,
  Channel,
  ChannelMember,
  ChannelVisibility,
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
  Notice as NoteNotice,
  Settings,
} from '@homingbird/protocol'
import { type AgentAsk, requestBody, upsertRequest } from './draft-requests.ts'
import { preferredLanguage } from './languages.ts'
import { applyEvent } from './live.ts'
import { type Attempt, refusalText } from './refusals.ts'
import { hrefFor } from './routes.ts'
import {
  type Branding,
  agentCredentials,
  archiveDiscards,
  branding,
  channels,
  channelsLoaded,
  connection,
  contacts,
  conversations,
  conversationsLoaded,
  directory,
  draftRequests,
  notice,
  releases,
  replyTargets,
  sendingIn,
  serverInfo,
  session,
  signedIn,
  threads,
} from './state.ts'
import { strings, useLanguage } from './strings.ts'
import { noteAwaitingReply, withNoteFiled, withoutNote } from './thread.ts'

export type Action<A = void> = T.Task<A, ApiError, HasClock>

export const api = httpApi({ serverUrl: globalThis.location?.origin ?? '', sendsCookies: true })

export const launch = <A>(action: Action<A>, then?: (value: A) => void, attempt?: Attempt): void =>
  void T.run(action, { clock: systemClock }).then((exit) => {
    if (exit._tag === 'Ok') return then?.(exit.value)
    if (exit.error._tag === 'Fail') return reportFailure(exit.error.error, attempt)
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
  reportVisibility()
})

/**
 * Tells the server whether a person can see this page, so a minimised window or a background tab
 * still gets a push notification. A visible report is renewed while the page stays visible.
 */
const reportVisibility = (): void => {
  const page = crypto.randomUUID()
  const report = (): Action =>
    T.asUnit(
      T.catchAll(() => T.unit)(
        api['presence.visibility']({ body: { page, visible: document.visibilityState === 'visible' } }),
      ),
    )
  document.addEventListener('visibilitychange', () => launch(report()))
  T.runFork(
    T.forever(VISIBLE_RENEWAL_MS)(
      T.suspend(() => (document.visibilityState === 'visible' ? report() : T.unit)),
    ),
    { clock: systemClock },
  )
}

const VISIBLE_RENEWAL_MS = 60_000

export const loadWorkspace: Action = T.gen(function* () {
  const [listed, people, ties] = yield* T.all([
    api['conversations.list']({}),
    api['directory.list']({ query: {} }),
    api['contacts.list']({}),
  ])
  conversations.set(listed.conversations)
  conversationsLoaded.set(true)
  directory.set(people.entries)
  contacts.set(ties.contacts)
  yield* loadAgents
  yield* loadChannels('')
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
    if ('inReplyTo' in ask.destination) forgetRelease(ask.destination.inReplyTo)
    return request
  })(api['draftRequests.create']({ body: requestBody(ask) }))

/** Keeps what the server remembered for this person, so a reload shows the same as the live event did. */
export const rememberNotices = (id: ConversationId, notices: ReadonlyArray<NoteNotice>): void => {
  releases.update((all) => {
    const kept = new Map(all)
    for (const notice of notices)
      if (notice.kind === 'released')
        kept.set(notice.noteId, { reason: notice.reason, agentName: notice.agentName })
    return kept
  })
  archiveDiscards.update((all) =>
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

export const forgetRelease = (noteId: NoteId): void =>
  releases.update((all) => {
    if (!all.has(noteId)) return all
    const remaining = new Map(all)
    remaining.delete(noteId)
    return remaining
  })

export const withdrawRequest = (request: DraftRequest): Action =>
  T.map((cancelled: DraftRequest) => draftRequests.update((all) => upsertRequest(all, cancelled)))(
    api['draftRequests.cancel']({ params: { id: request.id } }),
  )

export const loadConversations: Action = T.map((listed: { conversations: ReadonlyArray<Conversation> }) => {
  conversations.set(listed.conversations)
  conversationsLoaded.set(true)
})(api['conversations.list']({}))

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
    rememberNotices(id, page.notices)
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

export const loadChannels = (query: string): Action<ReadonlyArray<Channel>> =>
  T.map((listed: ChannelPage) => {
    if (query === '') {
      channels.set(listed.channels)
      channelsLoaded.set(true)
    }
    return listed.channels
  })(api['channels.list']({ query: { limit: String(KNOWN_CHANNELS), ...(query !== '' && { q: query }) } }))

export const CHANNEL_PAGE = 20

export interface ChannelPage {
  readonly channels: ReadonlyArray<Channel>
  readonly hasMore: boolean
  readonly cursor: string | null
}

export const loadChannelPage = (query: string, cursor: string | null): Action<ChannelPage> =>
  api['channels.list']({
    query: {
      limit: String(CHANNEL_PAGE),
      ...(query !== '' && { q: query }),
      ...(cursor !== null && { cursor }),
    },
  })

export const createChannel = (
  slug: string,
  description: string,
  visibility: ChannelVisibility,
): Action<Channel> =>
  T.gen(function* () {
    const created = yield* api['channels.create']({ body: { slug, description, visibility } })
    yield* afterChannelChange
    return created
  })

export const joinChannel = (slug: string, answering: boolean): Action =>
  T.flatMap(() => afterChannelChange)(api['channels.join']({ params: { slug }, body: { answering } }))

export const leaveChannel = (slug: string): Action =>
  T.flatMap(() => afterChannelChange)(api['channels.leave']({ params: { slug } }))

export const setAnswering = (slug: string, answering: boolean): Action =>
  T.flatMap(() => afterChannelChange)(
    (answering ? api['channels.answering.on'] : api['channels.answering.off'])({ params: { slug } }),
  )

export const loadChannelMembers = (slug: string): Action<ReadonlyArray<ChannelMember>> =>
  T.map((listed: { members: ReadonlyArray<ChannelMember> }) => listed.members)(
    api['channels.members.list']({ params: { slug } }),
  )

export const setChannelMember = (slug: string, memberId: MemberId, isMember: boolean): Action =>
  T.flatMap(() => afterChannelChange)(
    (isMember ? api['channels.members.add'] : api['channels.members.remove'])({ params: { slug, memberId } }),
  )

export const setChannelManager = (slug: string, memberId: MemberId, isManager: boolean): Action =>
  T.flatMap(() => afterChannelChange)(
    (isManager ? api['channels.managers.add'] : api['channels.managers.remove'])({
      params: { slug, memberId },
    }),
  )

export const setChannelVisibility = (slug: string, visibility: ChannelVisibility): Action =>
  T.flatMap(() => afterChannelChange)(
    api['channels.visibility.set']({ params: { slug }, body: { visibility } }),
  )

export const askChannel = (slug: string, body: string): Action<ConversationId> =>
  T.gen(function* () {
    const draft = yield* api['drafts.create']({ body: { body, channel: slug } })
    yield* api['drafts.send']({ params: { id: draft.id }, body: {} })
    yield* loadConversations
    return draft.conversationId
  })

export const moveQuestion = (note: Note, slug: string): Action =>
  T.gen(function* () {
    yield* api['notes.move']({ params: { id: note.id }, body: { channel: slug } })
    forgetNote(note.conversationId, note.id)
    yield* afterChannelChange
  })

export const createChannelThen = (
  channel: { readonly slug: string; readonly description: string },
  next: (slug: string) => Action,
): Action<{ readonly created: Channel; readonly failure: ApiError | null }> =>
  T.gen(function* () {
    const created = yield* api['channels.create']({ body: { ...channel, visibility: 'open' } })
    const outcome = yield* T.result(next(created.slug))
    yield* afterChannelChange
    return { created, failure: outcome._tag === 'Ok' ? null : outcome.error }
  })

export const readdressDraft = (draft: Note, slug: string): Action =>
  T.gen(function* () {
    const moved = yield* api['drafts.update']({ params: { id: draft.id }, body: { channel: slug } })
    rememberNote(moved)
    yield* loadConversations
    location.hash = hrefFor({ name: 'conversation', id: moved.conversationId })
  })

export const reviseChannel = (slug: string, changes: { slug?: string; description?: string }): Action =>
  T.flatMap(() => afterChannelChange)(api['admin.channels.update']({ params: { slug }, body: changes }))

export const archiveChannel = (slug: string, moveMembersTo: string | null): Action =>
  T.flatMap(() => afterChannelChange)(
    api['admin.channels.archive']({
      params: { slug },
      body: moveMembersTo === null ? {} : { moveMembersTo },
    }),
  )

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
  return me === null || kind === 'channel' ? null : (noteAwaitingReply(notes, me.member.id)?.id ?? null)
}

export const rememberNote = (note: Note): void => threads.update((all) => withNoteFiled(all, note))

export const forgetNote = (conversationId: ConversationId, id: NoteId): void =>
  threads.update((all) => {
    const thread = all.get(conversationId)
    return thread === undefined
      ? all
      : new Map(all).set(conversationId, { ...thread, notes: withoutNote(thread.notes, id) })
  })

const KNOWN_CHANNELS = 200

const afterChannelChange: Action = T.gen(function* () {
  yield* T.all([loadChannels(''), loadConversations, loadPeople])
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
  let lastSeq: number | null = null
  let running = new AbortController()
  const follow = (): void => {
    const signal = running.signal
    const events = eventStream(
      {
        serverUrl: location.origin,
        sendsCookies: true,
        clock: systemClock,
        fetch: reportingConnection,
        ...(lastSeq !== null && { after: lastSeq }),
      },
      signal,
    )
    T.runFork(
      Stream.forEach((event: Parameters<typeof applyEvent>[0]) =>
        T.sync(() => {
          if (event.seq > 0) lastSeq = event.seq
          applyEvent(event)
        }),
      )(events),
    )
  }
  globalThis.addEventListener('offline', () => {
    running.abort()
    connection.set('offline')
  })
  globalThis.addEventListener('online', () => {
    running.abort()
    running = new AbortController()
    connection.set('connecting')
    follow()
  })
  follow()
}

const reportFailure = (error: ApiError, attempt?: Attempt): void => {
  if (error._tag === 'Unauthorized') {
    session.set(null)
    return
  }
  notice.set({ kind: 'error', text: refusalText(error, attempt) })
  if (error._tag === 'Conflict') launch(loadConversations)
}

const withoutKey = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  const copy = new Map(map)
  copy.delete(key)
  return copy
}

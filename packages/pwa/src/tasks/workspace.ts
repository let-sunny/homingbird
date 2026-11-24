import { Task as T } from '@homingbird/kernel'
import type { AsRead, DraftRequest } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { featureOn } from '../features.ts'
import type { Branding } from '../state.ts'
import { loadActivity } from './activity.ts'
import { closeSettledDraftNotices } from './notifications.ts'

export const loadWorkspace: Action = T.gen(function* () {
  const { api, state } = yield* T.ask<App>()
  const listing = ++state.conversationLoads.started
  const [listed, people, ties] = yield* T.all([
    api['conversations.list']({}),
    api['directory.list']({ query: {} }),
    api['contacts.list']({}),
  ])
  keepNewerConversations(state, listing, listed.conversations)
  state.directory.set(people.entries)
  state.directoryLoaded.set(true)
  state.contacts.set(ties.contacts)
  yield* loadAgents
  yield* loadKnownChannels
  yield* loadActivity
  yield* T.result(closeNoticesOfSettledDrafts)
})

export const loadAgents: Action = T.gen(function* () {
  const { api, state } = yield* T.ask<App>()
  const [asked, issued] = yield* T.all([openDraftRequests, api['credentials.list']({})])
  state.draftRequests.set(asked)
  state.agentCredentials.set(
    issued.credentials.filter((credential) => credential.kind === 'agent' && credential.revokedAt === null),
  )
})

export const loadConversations: Action = withApp(({ api, state }) =>
  T.suspend(() => {
    const listing = ++state.conversationLoads.started
    return T.map((listed: { conversations: ReadonlyArray<AsRead.Conversation> }) =>
      keepNewerConversations(state, listing, listed.conversations),
    )(api['conversations.list']({}))
  }),
)

/** An answer that started before the one already shown is older, so it never replaces it: a note that arrived meanwhile stays. */
const keepNewerConversations = (
  state: App['state'],
  listing: number,
  conversations: ReadonlyArray<AsRead.Conversation>,
): void => {
  if (listing < state.conversationLoads.applied) return
  state.conversationLoads.applied = listing
  state.conversations.set(conversations)
  state.conversationsLoaded.set(true)
}

export const loadPeople: Action = T.gen(function* () {
  const { api, state } = yield* T.ask<App>()
  const [people, ties] = yield* T.all([api['directory.list']({ query: {} }), api['contacts.list']({})])
  state.directory.set(people.entries)
  state.directoryLoaded.set(true)
  state.contacts.set(ties.contacts)
})

/** The channels the person may know of, kept in state for the list, the picker and the people filter. */
export const loadKnownChannels: Action<ReadonlyArray<AsRead.Channel>> = withApp(({ api, state }) =>
  T.map((listed: { channels: ReadonlyArray<AsRead.Channel> }) => {
    state.channels.set(listed.channels)
    state.channelsLoaded.set(true)
    return listed.channels
  })(api['channels.list']({ query: { limit: String(KNOWN_CHANNELS) } })),
)

const KNOWN_CHANNELS = 200

/** The person's open draft requests; none while the organization has them switched off. */
const openDraftRequests: Action<ReadonlyArray<DraftRequest>> = withApp(({ api, state }) =>
  featureOn('draftRequests', state.serverInfo.get())
    ? T.catchTag('NotFound', () => T.succeed([] as ReadonlyArray<DraftRequest>))(
        T.map((listed: { requests: ReadonlyArray<DraftRequest> }) => listed.requests)(
          api['draftRequests.list']({}),
        ),
      )
    : T.succeed([]),
)

export const loadBranding: Action<Branding> = withApp(({ page, state }) =>
  T.catchAll(() => T.succeed(state.branding.get()))(
    T.gen(function* () {
      const response = yield* T.tryPromise(
        (signal) => page.fetch('/branding.json', { signal }),
        () => 'unavailable' as const,
      )
      const loaded = yield* T.tryPromise(
        () => response.json() as Promise<Partial<Branding>>,
        () => 'unavailable' as const,
      )
      return { name: typeof loaded.name === 'string' ? loaded.name : 'Homingbird', logo: loaded.logo ?? null }
    }),
  ),
)

/** Clears notifications about drafts sent or discarded elsewhere; a browser without push shows none. */
const closeNoticesOfSettledDrafts: Action = T.gen(function* () {
  const { api, page, clock } = yield* T.ask<App>()
  if (!page.supportsPush()) return
  const requestedAt = clock.now()
  const { drafts } = yield* api['drafts.list']({})
  yield* closeSettledDraftNotices(
    drafts.map((draft) => draft.id),
    requestedAt,
  )
})

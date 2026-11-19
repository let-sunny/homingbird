import { Task as T } from '@homingbird/kernel'
import type { AsRead, DraftRequest } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { featureOn } from '../features.ts'
import type { Branding } from '../state.ts'

export const loadWorkspace: Action = T.gen(function* () {
  const { api, state } = yield* T.ask<App>()
  const [listed, people, ties] = yield* T.all([
    api['conversations.list']({}),
    api['directory.list']({ query: {} }),
    api['contacts.list']({}),
  ])
  state.conversations.set(listed.conversations)
  state.conversationsLoaded.set(true)
  state.directory.set(people.entries)
  state.directoryLoaded.set(true)
  state.contacts.set(ties.contacts)
  yield* loadAgents
  yield* loadKnownChannels
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
  T.map((listed: { conversations: ReadonlyArray<AsRead.Conversation> }) => {
    state.conversations.set(listed.conversations)
    state.conversationsLoaded.set(true)
  })(api['conversations.list']({})),
)

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

import { Task as T } from '@homingbird/kernel'
import type { ApiError, AsRead, ConversationId, DraftRequest } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { featureOn } from '../features.ts'
import type { Load, Resource, Source } from '../resource.ts'
import { closeSettledReviewNotices } from './notifications.ts'
import { untilHolds } from './waiting-for.ts'

/**
 * A page shows these: each is asked for unless a request runs or one just did. Ends when they were
 * answered or failed once; a failure is told by whatever stands in the list's place, never from here.
 */
export const open = (...keys: ReadonlyArray<ResourceKey>): Action => each(keys, openOne)

/** These changed: each is asked for once more, after its running request when there is one. Never fails. */
export const invalidate = (...keys: ReadonlyArray<ResourceKey>): Action => each(keys, invalidateOne)

/** These changed and are asked for shortly: until then a page that opens asks, however new the last answer is. */
export const expire = (app: App, keys: ReadonlyArray<ResourceKey>): void => {
  for (const key of keys) resourceOf(app, key).expire()
}

/** Ends with a request that started after this call; true when it was answered. Never fails. */
export const refresh = (key: ResourceKey): Action<boolean> => withApp((app) => refreshOne(app, key))

/**
 * Waits for answers asked for after this call, as an action does before it shows what it changed. The
 * change worked, so a failure here is not its failure and nobody is told; nor does a slow answer hold it up.
 */
export const reread = (...keys: ReadonlyArray<ResourceKey>): Action =>
  withApp((app) =>
    T.asUnit(
      T.result(T.timeout(REREAD_LIMIT_SECONDS * 1000)(T.all(keys.map((key) => refreshOne(app, key))))),
    ),
  )

/** Try again: those asked for anew, each ending its running request. */
export const again = (...keys: ReadonlyArray<ResourceKey>): Action => each(keys, againOne)

/** Try again for each list that failed or takes too long, and for no other. */
export const againWhatIsStuck: Action = withApp(({ state }) =>
  again(...keysAt(state, (step) => step === 'failed' || step === 'long')),
)

/** Asks afresh for each list that failed, as when the network is back. */
export const againWhatFailed: Action = withApp(({ state }) =>
  again(...keysAt(state, (step) => step === 'failed')),
)

/** What the page is drawn from; until each was read, the line above the lists tells how that goes. */
export const WORKSPACE = [
  'conversations',
  'directory',
  'contacts',
  'channels',
  'agentCredentials',
  'draftRequests',
] as const satisfies ReadonlyArray<ResourceKey>

/** What the activity lists, besides the conversations. */
export const ACTIVITY = [
  'awaitingReply',
  'reviews',
  'suggestions',
  'debates',
] as const satisfies ReadonlyArray<ResourceKey>

export interface Resources {
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly contacts: ReadonlyArray<AsRead.Contact>
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly agentCredentials: ReadonlyArray<AsRead.Credential>
  readonly draftRequests: ReadonlyArray<DraftRequest>
  readonly awaitingReply: ReadonlyArray<ConversationId>
  readonly reviews: ReadonlyArray<AsRead.Review>
  readonly suggestions: ReadonlyArray<AsRead.DebateSuggestion>
  readonly debates: ReadonlyArray<AsRead.DebateSummary>
}

export type ResourceKey = keyof Resources

/** How each is asked for. One whose feature is off is empty, and nothing is asked. */
const ASKS: { readonly [Key in ResourceKey]: Action<Resources[Key]> } = {
  conversations: withApp(({ api }) =>
    T.map((listed: { conversations: Resources['conversations'] }) => listed.conversations)(
      api['conversations.list']({}),
    ),
  ),
  directory: withApp(({ api }) =>
    T.map((listed: { entries: Resources['directory'] }) => listed.entries)(
      api['directory.list']({ query: {} }),
    ),
  ),
  contacts: withApp(({ api }) =>
    T.map((listed: { contacts: Resources['contacts'] }) => listed.contacts)(api['contacts.list']({})),
  ),
  channels: withApp(({ api }) =>
    T.map((listed: { channels: Resources['channels'] }) => listed.channels)(
      api['channels.list']({ query: { limit: String(KNOWN_CHANNELS) } }),
    ),
  ),
  agentCredentials: withApp(({ api }) =>
    T.map((issued: { credentials: Resources['agentCredentials'] }) =>
      issued.credentials.filter((one) => one.kind === 'agent' && one.revokedAt === null),
    )(api['credentials.list']({})),
  ),
  draftRequests: whileOn(
    'draftRequests',
    withApp(({ api }) =>
      T.map((listed: { requests: Resources['draftRequests'] }) => listed.requests)(
        api['draftRequests.list']({}),
      ),
    ),
  ),
  awaitingReply: withApp(({ api }) =>
    T.map((inbox: { items: ReadonlyArray<AsRead.InboxItem> }) =>
      inbox.items.map((item) => item.conversation.id),
    )(api['inbox.list']({ query: {} })),
  ),
  reviews: whileOn(
    'channelAgents',
    withApp(({ api }) =>
      T.map((listed: { reviews: Resources['reviews'] }) => listed.reviews)(api['reviews.list']({})),
    ),
  ),
  suggestions: whileOn(
    'debateSuggestions',
    withApp(({ api }) =>
      T.map((listed: { suggestions: Resources['suggestions'] }) => listed.suggestions)(
        api['debateSuggestions.list']({}),
      ),
    ),
  ),
  debates: whileOn(
    'debateRooms',
    withApp(({ api }) =>
      T.map((listed: { debates: Resources['debates'] }) => listed.debates)(api['debates.list']({})),
    ),
  ),
}

function whileOn<A>(
  feature: Parameters<typeof featureOn>[0],
  ask: Action<ReadonlyArray<A>>,
): Action<ReadonlyArray<A>> {
  return withApp(({ state }) => {
    if (!featureOn(feature, state.serverInfo.get())) return T.succeed([])
    return T.catchTag('NotFound', () => T.succeed([] as ReadonlyArray<A>))(ask)
  })
}

const keysAt = (state: App['state'], holds: (step: Load['step']) => boolean): ResourceKey[] =>
  [...WORKSPACE, ...ACTIVITY].filter((key) => holds(state[key].load.get().step))

const each = (
  keys: ReadonlyArray<ResourceKey>,
  step: (app: App, key: ResourceKey) => T.Task<unknown>,
): Action => withApp((app) => T.asUnit(T.all(keys.map((key) => step(app, key)))))

const openOne = <Key extends ResourceKey>(app: App, key: Key) => resourceOf(app, key).open(sourceOf(app, key))

const invalidateOne = <Key extends ResourceKey>(app: App, key: Key) =>
  resourceOf(app, key).invalidate(sourceOf(app, key))

const refreshOne = <Key extends ResourceKey>(app: App, key: Key) =>
  resourceOf(app, key).refresh(sourceOf(app, key))

const againOne = <Key extends ResourceKey>(app: App, key: Key) =>
  resourceOf(app, key).again(sourceOf(app, key))

const resourceOf = <Key extends ResourceKey>({ state }: App, key: Key): Resource<Resources[Key]> => {
  const held: { readonly [One in ResourceKey]: Resource<Resources[One]> } = state
  return held[key]
}

const sourceOf = <Key extends ResourceKey>(app: App, key: Key): Source<Resources[Key]> => {
  const { state, clock, ended, endSession, launch } = app
  const connection = state.connection.get()
  const ask: Action<Resources[Key]> = ASKS[key]
  return {
    ask: T.make((_, signal) =>
      (state.stream.get() === 'awaited' ? T.flatMap(() => ask)(untilStreamSettled) : ask).run(app, signal),
    ),
    clock,
    ended,
    hearsChanges: connection === 'live' || connection === 'connecting',
    answered: (askedAt) => {
      if (key === 'reviews') launch(closeSettledReviewNotices(askedAt))
    },
    failed: (error: ApiError) => {
      if (error._tag === 'Unauthorized') endSession()
    },
    broke: (defect) => state.notice.set({ kind: 'error', text: String(defect) }),
  }
}

const untilStreamSettled: Action = withApp(({ state }) =>
  untilHolds(state.stream, (stream) => stream !== 'awaited'),
)

const KNOWN_CHANNELS = 200

const REREAD_LIMIT_SECONDS = 5

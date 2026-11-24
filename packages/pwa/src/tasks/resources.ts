import { Task as T } from '@homingbird/kernel'
import type { ApiError, AsRead, ConversationId } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { featureOn } from '../features.ts'
import type { Resource, Source } from '../resource.ts'
import { closeSettledReviewNotices } from './notifications.ts'

/**
 * A page shows these: each is asked for unless a request runs or one just did. Ends when they were
 * answered or failed once; a failure is told by whatever stands in the list's place, never from here.
 */
export const open = (...keys: ReadonlyArray<ResourceKey>): Action => each(keys, openOne)

/** These changed: each is asked for once more, after its running request when there is one. Never fails. */
export const invalidate = (...keys: ReadonlyArray<ResourceKey>): Action => each(keys, invalidateOne)

/** Ends with a request that started after this call; true when it was answered. Never fails. */
export const refresh = (key: ResourceKey): Action<boolean> => withApp((app) => refreshOne(app, key))

/** Try again: those asked for anew, each ending its running request. */
export const again = (...keys: ReadonlyArray<ResourceKey>): Action => each(keys, againOne)

export interface Resources {
  readonly awaitingReply: ReadonlyArray<ConversationId>
  readonly reviews: ReadonlyArray<AsRead.Review>
  readonly suggestions: ReadonlyArray<AsRead.DebateSuggestion>
  readonly debates: ReadonlyArray<AsRead.DebateSummary>
}

export type ResourceKey = keyof Resources

/** How each is asked for. One whose feature is off is empty, and nothing is asked. */
const ASKS: { readonly [Key in ResourceKey]: Action<Resources[Key]> } = {
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
    ask: T.make((_, signal) => ask.run(app, signal)),
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

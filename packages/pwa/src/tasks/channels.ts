import { Task as T } from '@homingbird/kernel'
import type {
  ApiError,
  AsRead,
  ChannelMember,
  ChannelVisibility,
  ConversationId,
  GroupId,
  MemberId,
} from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { withChannel } from '../channels.ts'
import { hrefFor } from '../routes.ts'
import { loadGroups } from './groups.ts'
import { loadingList } from './list-load.ts'
import { loadConversations, loadKnownChannels, loadPeople } from './workspace.ts'

export interface ChannelPage {
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly hasMore: boolean
  readonly cursor: string | null
}

export const CHANNEL_PAGE = 20

/** One page of the channel list, for what the person typed; a list still waited for tells its own failure. */
export const loadChannelPage = (
  query: string,
  cursor: string | null,
  isWaitedFor: boolean,
): Action<ChannelPage> =>
  loadingList(
    'channels',
    isWaitedFor,
    withApp(({ api }) =>
      api['channels.list']({
        query: {
          limit: String(CHANNEL_PAGE),
          ...(query !== '' && { q: query }),
          ...(cursor !== null && { cursor }),
        },
      }),
    ),
  )

/** Brings the known channels up to date beside a list that tells its own failure, so a failure is not told twice. */
export const refreshKnownChannels: Action = T.asUnit(T.result(loadKnownChannels))

/** Opens a channel and keeps it in the list straight away; the person who opens it is its first manager. */
export const createChannel = (
  slug: string,
  description: string,
  visibility: ChannelVisibility,
): Action<AsRead.Channel> =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    const created = yield* api['channels.create']({
      body: { slug, description, visibility },
    })
    yield* afterChannelChange
    yield* loadGroups
    state.channels.update((all) => withChannel(all, created))
    return created
  })

export const joinChannel = (slug: string, answering: boolean): Action =>
  withApp(({ api }) =>
    T.flatMap(() => afterChannelChange)(api['channels.join']({ params: { slug }, body: { answering } })),
  )

export const leaveChannel = (slug: string): Action =>
  withApp(({ api }) => T.flatMap(() => afterChannelChange)(api['channels.leave']({ params: { slug } })))

export const setAnswering = (slug: string, answering: boolean): Action =>
  withApp(({ api }) =>
    T.flatMap(() => afterChannelChange)(
      (answering ? api['channels.answering.on'] : api['channels.answering.off'])({ params: { slug } }),
    ),
  )

/** The members of a channel the person manages, remembered as its roster. */
export const loadChannelMembers = (slug: string): Action<ReadonlyArray<ChannelMember>> =>
  withApp(({ api, state }) =>
    T.map((listed: { members: ReadonlyArray<ChannelMember> }) => {
      state.rosters.update((all) =>
        new Map(all).set(slug, { memberCount: listed.members.length, members: listed.members }),
      )
      return listed.members
    })(api['channels.members.list']({ params: { slug } })),
  )

export const setChannelMember = (slug: string, memberId: MemberId, isMember: boolean): Action =>
  withApp(({ api }) =>
    T.flatMap(() => afterChannelChange)(
      (isMember ? api['channels.members.add'] : api['channels.members.remove'])({
        params: { slug, memberId },
      }),
    ),
  )

/** Adds the people in a team to a channel's managers, once; they join its room. */
export const addTeam = (slug: string, groupId: GroupId): Action =>
  withApp(({ api }) =>
    T.flatMap(() => T.asUnit(T.all([afterChannelChange, loadGroups])))(
      api['channels.managers.addTeam']({ params: { slug }, body: { groupId } }),
    ),
  )

/** Asks a channel a question in one step and returns the room it went to. */
export const askChannel = (slug: string, body: string): Action<ConversationId> =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    const draft = yield* api['drafts.create']({ body: { body, channel: slug } })
    yield* api['drafts.send']({
      params: { id: draft.id },
      body: { expected: { body, conversationId: draft.conversationId } },
    })
    yield* loadConversations
    return draft.conversationId
  })

/** Opens a room the person just asked in, once the list knows it. */
export const enterRoom = (conversationId: string): Action =>
  T.gen(function* () {
    const { page } = yield* T.ask<App>()
    yield* loadConversations
    page.go(hrefFor({ name: 'conversation', id: conversationId, draft: null }))
  })

/** Opens a channel and takes the next step there; the channel stays open even when the step fails. */
export const createChannelThen = (
  channel: { readonly slug: string; readonly description: string },
  next: (slug: string) => Action,
): Action<{ readonly created: AsRead.Channel; readonly failure: ApiError | null }> =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    const created = yield* api['channels.create']({ body: { ...channel, visibility: 'open' } })
    const outcome = yield* T.result(next(created.slug))
    yield* afterChannelChange
    return { created, failure: outcome._tag === 'Ok' ? null : outcome.error }
  })

export const reviseChannel = (slug: string, changes: { slug?: string; description?: string }): Action =>
  withApp(({ api }) =>
    T.flatMap(() => afterChannelChange)(api['admin.channels.update']({ params: { slug }, body: changes })),
  )

export const archiveChannel = (slug: string, moveMembersTo: string | null): Action =>
  withApp(({ api }) =>
    T.flatMap(() => afterChannelChange)(
      api['admin.channels.archive']({
        params: { slug },
        body: moveMembersTo === null ? {} : { moveMembersTo },
      }),
    ),
  )

const afterChannelChange: Action = T.suspend(() =>
  T.asUnit(T.all([loadKnownChannels, loadConversations, loadPeople])),
)

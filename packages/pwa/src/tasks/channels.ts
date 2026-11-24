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
import { batch } from '@homingbird/ui'
import { type Action, type App, withApp } from '../app.ts'
import { type ListedChannels, withChannel, withRowsOf } from '../channels.ts'
import { hrefFor } from '../routes.ts'
import { again, invalidate, open, reread } from './resources.ts'

/**
 * The channel list for what the person typed, asked afresh; the next page follows the ones shown. What
 * answered something else goes at once, so that it never passes for an answer that does not come.
 */
export const loadChannelPage = (query: string, after: ListedChannels | null): Action =>
  withApp(({ state }) => {
    batch(() => {
      state.channelPageWish.set({ query, after })
      state.channelPage.reset()
      if (after !== null) state.channelPage.set(after)
    })
    return again('channelPage')
  })

/** The first page, as the channels page opens; nothing of an earlier visit stays. */
export const openChannelPage: Action = withApp(({ state }) => {
  state.channelPage.reset()
  state.channelPageWish.set({ query: '', after: null })
  return open('channelPage')
})

/** The known channels changed: a first page is asked for once more, the rows of several are updated in place. */
export const reloadChannelPage: Action = withApp(({ state }) => {
  if (state.channelPageWish.get().after === null) return invalidate('channelPage')
  state.channelPage.update((listed) => withRowsOf(listed, state.channels.get()))
  return T.unit
})

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
    yield* reread('groups')
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
    T.flatMap(() => T.asUnit(T.all([afterChannelChange, reread('groups')])))(
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
    yield* reread('conversations')
    return draft.conversationId
  })

/** Opens a room the person just asked in, once the list knows it. */
export const enterRoom = (conversationId: string): Action =>
  T.gen(function* () {
    const { page } = yield* T.ask<App>()
    yield* reread('conversations')
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

const afterChannelChange: Action = T.suspend(() => reread('channels', 'conversations', 'directory'))

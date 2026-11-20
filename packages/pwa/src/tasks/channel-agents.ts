import { Task as T } from '@homingbird/kernel'
import type { ApiError, AsRead, CredentialId } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { withDraftRead } from '../drafts-read.ts'
import { featureOn } from '../features.ts'
import { hrefFor } from '../routes.ts'
import { loadConversations, loadKnownChannels } from './workspace.ts'

/** The answers waiting for this person, read again whenever one changes; none while channel agents are off. */
export const loadReviews: Action = T.gen(function* () {
  const { api, state } = yield* T.ask<App>()
  if (!featureOn('channelAgents', state.serverInfo.get())) return
  state.reviews.set((yield* api['reviews.list']({})).reviews)
})

/**
 * Sends an answer as the manager read it, or as they edited it; a refusal because the agent changed it
 * reads the list again, so that the card shows the change and asks them to read it again.
 */
export const sendReview = (review: AsRead.Review, editedBody: string | null): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    const expected = state.reviewsRead.get().get(review.note.id) ?? {
      body: review.note.body,
      conversationId: review.note.conversationId,
    }
    yield* T.tapError((error: ApiError) => (error._tag === 'Conflict' ? loadReviews : T.unit))(
      api['drafts.send']({
        params: { id: review.note.id },
        body: editedBody === null ? { expected } : { body: editedBody, expected },
      }),
    )
    yield* loadReviews
  })

export const discardReview = (review: AsRead.Review): Action =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    yield* api['drafts.discard']({ params: { id: review.note.id } })
    yield* loadReviews
  })

/** The manager read an answer again after the agent changed it, and may send it now. */
export const confirmReviewRead = (review: AsRead.Review): Action =>
  withApp(({ state }) => T.sync(() => state.reviewsRead.update((read) => withDraftRead(read, review.note))))

export const loadChannelAgent = (slug: string): Action<AsRead.ChannelAgent | null> =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    const read = yield* T.result(api['channels.agent.get']({ params: { slug } }))
    if (read._tag === 'Err' && read.error._tag !== 'NotFound') return yield* T.fail(read.error)
    const agent = read._tag === 'Ok' ? read.value : null
    state.channelAgents.update((all) => {
      const known = new Map(all)
      if (agent === null) known.delete(slug)
      else known.set(slug, agent)
      return known
    })
    return agent
  })

/** How the channel's agent is doing, or null for anyone who does not manage the channel. */
export const loadChannelAgentFigures = (slug: string): Action<AsRead.ChannelAgentReport | null> =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    const read = yield* T.result(api['channels.agent.figures']({ params: { slug } }))
    if (read._tag === 'Ok') return read.value
    return read.error._tag === 'NotFound' ? null : yield* T.fail(read.error)
  })

export const createChannelAgent = (slug: string, name: string): Action =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    yield* api['channels.agent.create']({ params: { slug }, body: { name } })
    yield* afterAgentChange(slug)
  })

export const renameChannelAgent = (slug: string, name: string): Action =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    yield* api['channels.agent.rename']({ params: { slug }, body: { name } })
    yield* afterAgentChange(slug)
  })

export const retireChannelAgent = (slug: string): Action =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    yield* api['channels.agent.retire']({ params: { slug } })
    yield* afterAgentChange(slug)
    yield* loadReviews
  })

export const disconnectAgentDesk = (slug: string, id: CredentialId): Action =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    yield* api['channels.agent.credentials.revoke']({ params: { slug, id } })
    yield* loadChannelAgent(slug)
  })

/** Opens the person's own conversation with a channel's agent, and goes there. */
export const askPrivately = (slug: string): Action =>
  T.gen(function* () {
    const { api, page } = yield* T.ask<App>()
    const room = yield* api['channels.askPrivately']({ params: { slug } })
    yield* loadConversations
    page.go(hrefFor({ name: 'conversation', id: room.id, draft: null }))
  })

const afterAgentChange = (slug: string): Action =>
  T.gen(function* () {
    yield* loadChannelAgent(slug)
    yield* loadKnownChannels
  })

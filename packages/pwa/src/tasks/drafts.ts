import { Task as T } from '@homingbird/kernel'
import type { AsRead, DraftRequest, NoteId } from '@homingbird/protocol'
import { track } from '../analytics.ts'
import { type Action, type App, withApp } from '../app.ts'
import { type AgentAsk, requestBody, upsertRequest } from '../draft-requests.ts'
import { hrefFor } from '../routes.ts'
import { forgetNote, forgetRelease, loadThread, rememberNote } from './notes.ts'
import { refreshAgentReport, refreshPrinciples } from './teaching.ts'
import { loadConversations } from './workspace.ts'

/** Sends a draft, edited or as written, and discards the alternatives it was chosen from. */
export const approveDraft = (
  draft: AsRead.Note,
  editedBody: string | null,
  alternatives: ReadonlyArray<AsRead.Note>,
): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    rememberNote(state)(
      yield* api['drafts.send']({
        params: { id: draft.id },
        body: editedBody === null ? {} : { body: editedBody },
      }),
    )
    yield* track('draft_approved', {})
    for (const alternative of alternatives)
      yield* T.result(api['drafts.discard']({ params: { id: alternative.id } }))
    yield* refreshAgentReport
    yield* refreshPrinciples
    yield* loadThread(draft.conversationId)
    yield* loadConversations
  })

export const saveDraft = (draft: AsRead.Note, body: string): Action =>
  withApp(({ api, state }) =>
    T.map(rememberNote(state))(api['drafts.update']({ params: { id: draft.id }, body: { body } })),
  )

export const discardDraft = (draft: AsRead.Note): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    yield* api['drafts.discard']({ params: { id: draft.id } })
    forgetNote(state, draft.conversationId, draft.id)
    yield* refreshAgentReport
    yield* refreshPrinciples
    yield* loadConversations
  })

/** Sends a draft to another channel's room, and opens that room. */
export const readdressDraft = (draft: AsRead.Note, slug: string): Action =>
  T.gen(function* () {
    const { api, state, page } = yield* T.ask<App>()
    const moved = yield* api['drafts.update']({ params: { id: draft.id }, body: { channel: slug } })
    rememberNote(state)(moved)
    yield* loadConversations
    page.go(hrefFor({ name: 'conversation', id: moved.conversationId }))
  })

/** Tells the server that a draft card is on a screen the person can see; a failure is dropped. */
export const reportDraftSeen = (id: NoteId): Action =>
  withApp(({ api }) => T.asUnit(T.catchAll(() => T.unit)(api['drafts.seen']({ params: { id } }))))

export const askAgent = (ask: AgentAsk): Action<DraftRequest> =>
  withApp(({ api, state }) =>
    T.map((request: DraftRequest) => {
      state.draftRequests.update((all) => upsertRequest(all, request))
      if ('inReplyTo' in ask.destination) forgetRelease(state, ask.destination.inReplyTo)
      return request
    })(api['draftRequests.create']({ body: requestBody(ask) })),
  )

export const withdrawRequest = (request: DraftRequest): Action =>
  withApp(({ api, state }) =>
    T.map((cancelled: DraftRequest) => state.draftRequests.update((all) => upsertRequest(all, cancelled)))(
      api['draftRequests.cancel']({ params: { id: request.id } }),
    ),
  )

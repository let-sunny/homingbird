import { Task as T } from '@homingbird/kernel'
import { ConversationId, NoteId } from '@homingbird/protocol'
import { requireCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'
import { draftLink, openOnServer, reviewChannelOf, reviewLink, webClientLink } from '../web-client.ts'

/** Opens the web client at a conversation or at one draft's card, where the person decides on it. */
export const open = (rawId: string | null): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const credential = yield* requireCredential
    const target = targetOf(rawId)
    if (target === null) return yield* T.fail(failed('That is not a conversation id or a draft id.'))
    const reviewChannel = yield* channelOfThisAgent
    if (reviewChannel !== null) {
      const link = reviewLink(credential.serverUrl, reviewChannel, target.kind === 'draft' ? target.id : null)
      const opened = yield* openOnServer(link, credential.serverUrl)
      return outcome(
        { link, opened },
        `${opened ? 'Opened ' : ''}${link}\nThe managers of #${reviewChannel} decide on this agent’s drafts there.`,
      )
    }
    const link =
      target.kind === 'draft'
        ? yield* draftLinkOf(credential.serverUrl, target.id)
        : webClientLink(credential.serverUrl, target.kind === 'conversation' ? target.id : null)
    const opened = yield* openOnServer(link, credential.serverUrl)
    return outcome(
      { link, opened },
      opened
        ? `Opened ${link}\nDrafts are approved, edited or discarded there.`
        : `${link}\nOpen it to approve, edit or discard drafts.`,
    )
  })

type Target =
  | { readonly kind: 'front' }
  | { readonly kind: 'conversation'; readonly id: ConversationId }
  | { readonly kind: 'draft'; readonly id: NoteId }

const targetOf = (rawId: string | null): Target | null => {
  if (rawId === null) return { kind: 'front' }
  const conversationId = ConversationId.decode(rawId)
  if (conversationId._tag === 'Ok') return { kind: 'conversation', id: conversationId.value }
  const noteId = NoteId.decode(rawId)
  return noteId._tag === 'Ok' ? { kind: 'draft', id: noteId.value } : null
}

/** A draft's card; a note sent since opens its conversation, and one this agent cannot see opens nothing. */
const draftLinkOf = (serverUrl: string, id: NoteId): T.Task<string, CliFailure, CliEnv> =>
  T.gen(function* () {
    const { api } = yield* openSession
    const note = yield* T.result(api['notes.get']({ params: { id } }))
    if (note._tag === 'Err') return yield* T.fail(failed('No draft with that id could be loaded.'))
    return note.value.status === 'draft'
      ? draftLink(serverUrl, note.value)
      : webClientLink(serverUrl, note.value.conversationId)
  })

/** A channel's agent's drafts are reviewed on its channel's page; anything that fails falls back to the conversation. */
const channelOfThisAgent: T.Task<string | null, never, CliEnv> = T.catchAll(() => T.succeed(null))(
  T.gen(function* () {
    const { api } = yield* openSession
    const me = yield* calling(api['me.get']({}))
    return yield* reviewChannelOf(api, me.member)
  }),
)

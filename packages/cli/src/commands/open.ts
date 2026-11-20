import { Task as T } from '@homingbird/kernel'
import { ConversationId } from '@homingbird/protocol'
import { requireCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'
import { openOnServer, reviewChannelOf, reviewLink, webClientLink } from '../web-client.ts'

export const open = (rawId: string | null): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const credential = yield* requireCredential
    const conversationId = rawId === null ? null : ConversationId.decode(rawId)
    if (conversationId !== null && conversationId._tag === 'Err')
      return yield* T.fail(failed('That is not a conversation id.'))
    const reviewChannel = yield* channelOfThisAgent
    if (reviewChannel !== null) {
      const link = reviewLink(credential.serverUrl, reviewChannel)
      const opened = yield* openOnServer(link, credential.serverUrl)
      return outcome(
        { link, opened },
        `${opened ? 'Opened ' : ''}${link}\nThe managers of #${reviewChannel} decide on this agent’s drafts there.`,
      )
    }
    const link = webClientLink(credential.serverUrl, conversationId === null ? null : conversationId.value)
    const opened = yield* openOnServer(link, credential.serverUrl)
    return outcome(
      { link, opened },
      opened
        ? `Opened ${link}\nDrafts are approved, edited or discarded there.`
        : `${link}\nOpen it to approve, edit or discard drafts.`,
    )
  })

/** A channel's agent's drafts are reviewed on its channel's page; anything that fails falls back to the conversation. */
const channelOfThisAgent: T.Task<string | null, never, CliEnv> = T.catchAll(() => T.succeed(null))(
  T.gen(function* () {
    const { api } = yield* openSession
    const me = yield* calling(api['me.get']({}))
    return yield* reviewChannelOf(api, me.member)
  }),
)

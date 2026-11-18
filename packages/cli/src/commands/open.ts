import { Task as T } from '@homingbird/kernel'
import { ConversationId } from '@homingbird/protocol'
import { requireCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { openOnServer, webClientLink } from '../web-client.ts'

export const open = (rawId: string | null): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const credential = yield* requireCredential('agent')
    const conversationId = rawId === null ? null : ConversationId.decode(rawId)
    if (conversationId !== null && conversationId._tag === 'Err')
      return yield* T.fail(failed('That is not a conversation id.'))
    const link = webClientLink(credential.serverUrl, conversationId === null ? null : conversationId.value)
    const opened = yield* openOnServer(link, credential.serverUrl)
    return outcome(
      { link, opened },
      opened
        ? `Opened ${link}\nDrafts are approved, edited or discarded there.`
        : `${link}\nOpen it to approve, edit or discard drafts.`,
    )
  })

import { Task as T, isOk } from '@homingbird/kernel'
import { type Authors, type DraftRequest, quotedNote } from '@homingbird/protocol'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { type Session, calling, openSession } from '../session.ts'
import { authorsOf } from './reading.ts'

export const requests: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const session = yield* openSession
  const listed = yield* T.result(session.api['draftRequests.list']({}))
  if (!isOk(listed) && listed.error._tag === 'NotFound')
    return outcome({ requests: [], turnedOff: true }, REQUESTS_OFF_TEXT)
  const { requests: waiting } = yield* calling(isOk(listed) ? T.succeed(listed.value) : T.fail(listed.error))
  if (waiting.length === 0) return outcome({ requests: [] }, 'No draft requests are waiting for this agent.')
  const authors = yield* authorsOf(session)
  const shown = yield* T.forEach(waiting, (request) =>
    T.map((answers: string | null) => ({
      id: request.id,
      conversationId: request.conversationId,
      inReplyTo: request.inReplyTo,
      instruction: request.instruction,
      expiresAt: request.expiresAt,
      answers,
    }))(originalOf(session, request, authors)),
  )
  return outcome(
    { requests: shown },
    shown
      .map((request) =>
        [
          `[${request.id}] for conversation ${request.conversationId}`,
          request.instruction.trim() === ''
            ? '  no instruction'
            : `  instruction: ${request.instruction.trim()}`,
          `  answer with: homingbird draft --request ${request.id} "<text>"`,
          ...(request.answers === null ? [] : [request.answers]),
        ].join('\n'),
      )
      .join('\n\n'),
  )
})

export const originalOf = (
  session: Session,
  request: DraftRequest,
  authors: Authors,
): T.Task<string | null, never, Pick<CliEnv, 'nonce'>> =>
  T.gen(function* () {
    if (request.inReplyTo === null) return null
    const env = yield* T.ask<Pick<CliEnv, 'nonce'>>()
    const note = yield* T.result(session.api['notes.get']({ params: { id: request.inReplyTo } }))
    return note._tag === 'Ok'
      ? quotedNote(note.value, { authors, nonce: env.nonce })
      : `(The note ${request.inReplyTo} could not be loaded.)`
  })

export const REQUESTS_OFF_TEXT =
  'Draft requests are turned off in this organization; this desk answers arriving notes only.'

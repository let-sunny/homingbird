import { eventStream } from '@homingbird/client'
import { Stream, Task as T } from '@homingbird/kernel'
import { type AsRead, type Authors, type MemberId, quotedNote } from '@homingbird/protocol'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { calling, openSession, requireReadable } from '../session.ts'
import { authorsOf } from './reading.ts'

export interface StreamLine {
  readonly event: AsRead.StreamEvent
  readonly wrapped?: string
}

export const stream = (
  after: number | null,
  emit: (line: StreamLine) => void,
): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const session = yield* openSession
    yield* requireReadable(session.api)
    const me = yield* calling(session.api['me.get']({}))
    let authors = yield* authorsOf(session)
    const events = eventStream(
      {
        serverUrl: session.credential.serverUrl,
        fetch: env.fetch,
        token: () => session.credential.token,
        clock: env.clock,
        ...(after !== null && { after }),
        onUnreadable: env.output.problem,
      },
      env.stopped,
    )
    yield* Stream.forEach((event: AsRead.StreamEvent) =>
      T.gen(function* () {
        if (isReceivedNote(event, me.member.id) && !authors.has(event.body.note.authorId))
          authors = yield* refreshed(authorsOf(session), authors)
        emit(toLine(event, me.member.id, authors, env.nonce))
      }),
    )(events)
  })

export const toLine = (
  event: AsRead.StreamEvent,
  viewerId: MemberId,
  authors: Authors,
  nonce: () => string,
): StreamLine =>
  isReceivedNote(event, viewerId)
    ? { event, wrapped: quotedNote(event.body.note, { authors, nonce }) }
    : { event }

type NoteSent = AsRead.StreamEvent & {
  readonly body: Extract<AsRead.StreamEvent['body'], { type: 'note.sent' }>
}

const isReceivedNote = (event: AsRead.StreamEvent, viewerId: MemberId): event is NoteSent =>
  event.body.type === 'note.sent' && event.body.note.authorId !== viewerId

/** The directory as it is now; when it cannot be read, the one already known. */
const refreshed = (latest: T.Task<Authors, CliFailure>, fallback: Authors): T.Task<Authors> =>
  T.map((exit: T.Exit<Authors, CliFailure>) => (exit._tag === 'Ok' ? exit.value : fallback))(T.exit(latest))

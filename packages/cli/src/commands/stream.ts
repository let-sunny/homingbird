import { eventStream } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import type { MemberId, StreamEvent } from '@homingbird/protocol'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Authors, quoteForModel } from '../quoting.ts'
import { calling, openSession } from '../session.ts'
import { authorsOf } from './reading.ts'

export interface StreamLine {
  readonly event: StreamEvent
  readonly wrapped?: string
}

export const stream = (
  after: number | null,
  emit: (line: StreamLine) => void,
): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const session = yield* openSession('agent')
    const me = yield* calling(session.api['me.get']({}))
    let authors = yield* authorsOf(session)
    const events = eventStream(
      {
        serverUrl: session.credential.serverUrl,
        fetch: env.fetch,
        token: () => session.credential.token,
        clock: env.clock,
        ...(after !== null && { after }),
      },
      env.stopped,
    )
    yield* T.promise(async () => {
      for await (const event of events) {
        if (isReceivedNote(event, me.member.id) && !authors.has(event.body.note.authorId))
          authors = await refreshed(authorsOf(session), authors)
        emit(toLine(event, me.member.id, authors, env.nonce))
      }
    })
  })

export const toLine = (event: StreamEvent, viewerId: MemberId, authors: Authors, nonce: () => string): StreamLine =>
  isReceivedNote(event, viewerId) ? { event, wrapped: quoteForModel(event.body.note, authors, nonce()) } : { event }

type NoteSent = StreamEvent & { readonly body: Extract<StreamEvent['body'], { type: 'note.sent' }> }

const isReceivedNote = (event: StreamEvent, viewerId: MemberId): event is NoteSent =>
  event.body.type === 'note.sent' && event.body.note.authorId !== viewerId

const refreshed = async (latest: T.Task<Authors, CliFailure>, fallback: Authors): Promise<Authors> => {
  const exit = await T.run(latest)
  return exit._tag === 'Ok' ? exit.value : fallback
}

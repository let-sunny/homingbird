import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type AsRead,
  type Authors,
  UNKNOWN_STATUS_TEXT,
  authorOf,
  authorsIn,
  describeStatus,
  quotedNote,
  summarize,
} from '@homingbird/protocol'
import type { TaskView } from './dialect.ts'
import type { MemberApi } from './member-api.ts'

export interface ViewContext {
  readonly api: MemberApi
  readonly publicUrl: string
  readonly nonce: () => string
}

export const taskViewOf = (note: AsRead.Note, context: ViewContext): T.Task<TaskView, ApiError> => {
  const base = {
    id: note.id,
    contextId: note.conversationId,
    metadata: { noteStatus: note.status, origin: note.origin },
  }
  if (note.status === 'draft')
    return T.succeed({
      ...base,
      phase: 'input_required',
      statusText: `Drafted, not sent. The member's human has to approve this note in Homingbird at ${context.publicUrl} before it goes anywhere.`,
      updatedAt: note.updatedAt,
      artifacts: [],
    })
  if (note.status === 'discarded')
    return T.succeed({
      ...base,
      phase: 'canceled',
      statusText: "The member's human discarded this draft. It was never sent.",
      updatedAt: note.updatedAt,
      artifacts: [],
    })
  if (note.status !== 'sent')
    return T.succeed({
      ...base,
      phase: 'input_required',
      statusText: `This note has a ${UNKNOWN_STATUS_TEXT}.`,
      updatedAt: note.updatedAt,
      artifacts: [],
    })
  const someoneReplied = note.receipts.some((receipt) => receipt.repliedAt !== null)
  return T.map(
    ({ replies, authors, answered }: Answers): TaskView => ({
      ...base,
      phase: answered ? 'completed' : 'working',
      statusText: `Approved and sent. ${describeStatus(summarize(note.receipts))}.`,
      updatedAt: Math.max(note.updatedAt, ...note.receipts.map((receipt) => receipt.repliedAt ?? 0)),
      artifacts: replies.map((reply) => ({
        id: reply.id,
        name: `Reply from ${authorOf(authors, reply.authorId).name}`,
        text: quotedNote(reply, { authors, nonce: context.nonce }),
      })),
    }),
  )(someoneReplied ? answersTo(note, context.api) : T.succeed(UNANSWERED))
}

interface Answers {
  readonly replies: ReadonlyArray<AsRead.Note>
  readonly authors: Authors
  readonly answered: boolean
}

const REPLY_SEARCH_WINDOW = '200'

const UNANSWERED: Answers = { replies: [], authors: new Map(), answered: false }

const answersTo = (note: AsRead.Note, api: MemberApi): T.Task<Answers, ApiError> =>
  T.gen(function* () {
    const conversation = yield* api['conversations.get']({ params: { id: note.conversationId } })
    const { notes } = yield* api['conversations.notes']({
      params: { id: note.conversationId },
      query: { limit: REPLY_SEARCH_WINDOW },
    })
    const { entries } = yield* api['directory.list']({ query: {} })
    const replies = notes.filter(
      (candidate) => candidate.inReplyTo === note.id && candidate.status === 'sent',
    )
    return {
      replies,
      authors: authorsIn(entries),
      answered: conversation.kind === 'channel' || isRepliedByEveryone(note),
    }
  })

const isRepliedByEveryone = (note: AsRead.Note): boolean =>
  note.receipts.every((receipt) => receipt.repliedAt !== null)

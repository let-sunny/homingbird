import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type MemberId,
  type Note,
  describeStatus,
  summarize,
  wrapNote,
} from '@homingbird/protocol'
import type { TaskView } from './dialect.ts'
import type { MemberApi } from './member-api.ts'

export interface ViewContext {
  readonly api: MemberApi
  readonly publicUrl: string
  readonly nonce: () => string
}

export const taskViewOf = (note: Note, context: ViewContext): T.Task<TaskView, ApiError> => {
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
  const everyoneReplied = note.receipts.every((receipt) => receipt.repliedAt !== null)
  const someoneReplied = note.receipts.some((receipt) => receipt.repliedAt !== null)
  return T.map(
    (replies: ReadonlyArray<Reply>): TaskView => ({
      ...base,
      phase: everyoneReplied ? 'completed' : 'working',
      statusText: `Approved and sent. ${describeStatus(summarize(note.receipts))}.`,
      updatedAt: Math.max(note.updatedAt, ...note.receipts.map((receipt) => receipt.repliedAt ?? 0)),
      artifacts: replies.map(({ reply, authorName, authorEmail }) => ({
        id: reply.id,
        name: `Reply from ${authorName}`,
        text: wrapNote({
          noteId: reply.id,
          authorName,
          authorEmail,
          sentAt: reply.sentAt,
          body: reply.body,
          nonce: context.nonce(),
        }),
      })),
    }),
  )(someoneReplied ? repliesTo(note, context.api) : T.succeed([]))
}

interface Reply {
  readonly reply: Note
  readonly authorName: string
  readonly authorEmail: string
}

const REPLY_SEARCH_WINDOW = '200'

const repliesTo = (note: Note, api: MemberApi): T.Task<ReadonlyArray<Reply>, ApiError> =>
  T.gen(function* () {
    const { notes } = yield* api['conversations.notes']({
      params: { id: note.conversationId },
      query: { limit: REPLY_SEARCH_WINDOW },
    })
    const { entries } = yield* api['directory.list']({ query: {} })
    const members = new Map<MemberId, { name: string; email: string }>(
      entries.map((entry) => [entry.member.id, entry.member]),
    )
    return notes
      .filter((candidate) => candidate.inReplyTo === note.id && candidate.status === 'sent')
      .map((reply) => ({
        reply,
        authorName: members.get(reply.authorId)?.name ?? 'Unknown member',
        authorEmail: members.get(reply.authorId)?.email ?? 'unknown',
      }))
  })

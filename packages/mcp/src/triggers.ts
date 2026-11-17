import { Task as T } from '@homingbird/kernel'
import type { ApiError, EventType } from '@homingbird/protocol'
import { quoteNote } from './quote.ts'
import type { ToolContext } from './tools.ts'

export interface Trigger {
  readonly kind: 'note'
  readonly meta: Readonly<Record<string, string>>
  readonly text: string
}

export const freshTriggers = (context: ToolContext): T.Task<ReadonlyArray<Trigger>, ApiError> =>
  T.map((found: ReadonlyArray<ReadonlyArray<Trigger>>) => found.flat())(
    T.forEach(TRIGGER_SOURCES, (source) => source(context)),
  )

export const WAKING_EVENTS: ReadonlyArray<EventType> = ['note.sent', 'resync']

type TriggerSource = (context: ToolContext) => T.Task<ReadonlyArray<Trigger>, ApiError>

const notesAwaitingReply: TriggerSource = (context) =>
  T.gen(function* () {
    const { items } = yield* context.api['inbox.list']({ query: { fresh: '1' } })
    yield* T.forEach(items, (item) => context.api['notes.pickup']({ params: { id: item.note.id } }))
    return items.map(({ note, author }) => ({
      kind: 'note' as const,
      meta: { kind: 'note', note_id: note.id, conversation_id: note.conversationId },
      text: [
        quoteNote(note, { nonce: context.nonce, authors: new Map([[author.id, author]]) }),
        `Draft a reply to this note with draft_reply, noteId ${note.id}. Your human approves it before it is sent.`,
      ].join('\n\n'),
    }))
  })

const TRIGGER_SOURCES: ReadonlyArray<TriggerSource> = [notesAwaitingReply]

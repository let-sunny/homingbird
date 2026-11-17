import { Task as T } from '@homingbird/kernel'
import { type Conversation, ConversationId, type MemberId, describeStatus, summarize } from '@homingbird/protocol'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { type Authors, quoteForModel, showThread } from '../quoting.ts'
import { type Session, calling, openSession } from '../session.ts'

export const directory = (query: string | null): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const { api } = yield* openSession('agent')
    const { entries } = yield* calling(api['directory.list']({ query: query === null ? {} : { q: query } }))
    return outcome(
      { entries },
      entries
        .map((entry) =>
          [
            `${entry.member.name} <${entry.member.email}> [${entry.member.id}]`,
            `  agent ${entry.presence.agentOnline ? 'online' : 'offline'}, person ${entry.presence.humanOnline ? 'online' : 'offline'}, ${
              entry.relation === 'self' ? 'this is you' : entry.canMessage ? 'can be messaged' : 'cannot be messaged'
            }`,
            ...(entry.member.profile === '' ? [] : [`  helps with: ${entry.member.profile}`]),
          ].join('\n'),
        )
        .join('\n') || 'Nobody matches.',
    )
  })

export const inbox = (fresh: boolean): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const { api } = yield* openSession('agent')
    const { items } = yield* calling(api['inbox.list']({ query: fresh ? { fresh: '1' } : {} }))
    const quoted = items.map((item) => ({
      noteId: item.note.id,
      conversationId: item.note.conversationId,
      from: { name: item.author.name, email: item.author.email },
      sentAt: item.note.sentAt,
      wrapped: quoteForModel(item.note, new Map([[item.author.id, item.author]]), env.nonce()),
    }))
    return outcome(
      { items: quoted },
      quoted.length === 0 ? 'No notes are waiting for a reply.' : quoted.map((item) => item.wrapped).join('\n\n'),
    )
  })

export const conversations: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const session = yield* openSession('agent')
  const { conversations: list } = yield* calling(session.api['conversations.list']({}))
  const authors = yield* authorsOf(session)
  const summaries = list.map((conversation) => ({
    id: conversation.id,
    with: namesIn(conversation, authors),
    unreadCount: conversation.unreadCount,
    draftCount: conversation.draftCount,
    lastActivityAt: conversation.lastActivityAt,
  }))
  return outcome(
    { conversations: summaries },
    summaries
      .map((one) => `[${one.id}] ${one.with} — ${one.unreadCount} unread, ${one.draftCount} drafts waiting`)
      .join('\n') || 'No conversations yet.',
  )
})

export const conversation = (rawId: string): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const session = yield* openSession('agent')
    const id = ConversationId.decode(rawId)
    if (id._tag === 'Err') return yield* T.fail(failed('That is not a conversation id.'))
    const me = yield* calling(session.api['me.get']({}))
    const { notes } = yield* calling(session.api['conversations.notes']({ params: { id: id.value }, query: {} }))
    const authors = yield* authorsOf(session)
    const shown = notes.map((note) => ({
      noteId: note.id,
      mine: note.authorId === me.member.id,
      status: note.status === 'sent' ? describeStatus(summarize(note.receipts)) : note.status,
      text: showThread([note], me.member.id, authors, env.nonce),
    }))
    return outcome(
      { conversationId: id.value, notes: shown },
      shown.map((note) => `${note.text}\n(${note.status})`).join('\n\n') || 'This conversation has no notes yet.',
    )
  })

export const authorsOf = (session: Session): T.Task<Authors, CliFailure> =>
  T.map((listed: { entries: ReadonlyArray<{ member: { id: MemberId; name: string; email: string } }> }) =>
    new Map(listed.entries.map((entry) => [entry.member.id, entry.member])),
  )(calling(session.api['directory.list']({ query: {} })))

const namesIn = (conversation: Conversation, authors: Authors): string =>
  conversation.title ??
  conversation.participantIds.map((memberId) => authors.get(memberId)?.name ?? 'Unknown member').join(', ')

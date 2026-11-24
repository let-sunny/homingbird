import { Task as T } from '@homingbird/kernel'
import {
  type AsRead,
  type Authors,
  ChannelSlug,
  ConversationId,
  type MemberId,
  UNKNOWN,
  UNKNOWN_STATUS_TEXT,
  authorOf,
  authorsIn,
  describeStatus,
  quotedIntroduction,
  quotedNote,
  quotedThread,
  summarize,
} from '@homingbird/protocol'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { type Session, calling, openSession } from '../session.ts'

export const directory = (
  query: string | null,
  channel: string | null,
): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const { api } = yield* openSession
    const { entries } = yield* calling(
      api['directory.list']({
        query: {
          ...(query !== null && { q: query }),
          ...(channel !== null && { channel: yield* channelSlug(channel) }),
        },
      }),
    )
    const introductions = entries.map((entry) =>
      quotedIntroduction(entry.member, entry.agentIntroduction, env.nonce),
    )
    return outcome(
      {
        entries: entries.map(({ agentIntroduction: _, ...entry }, index) => ({
          ...entry,
          aboutTheirAgent: introductions[index] ?? null,
        })),
      },
      entries
        .map((entry, index) =>
          [
            `${entry.member.name} <${entry.member.email}> [${entry.member.id}]`,
            `  agent ${entry.presence.agentOnline ? 'online' : 'offline'}, person ${entry.presence.humanOnline ? 'online' : 'offline'}, ${
              entry.relation === 'self'
                ? 'this is you'
                : entry.canMessage
                  ? 'can be messaged'
                  : 'cannot be messaged'
            }`,
            ...(entry.member.profile === '' ? [] : [`  helps with: ${entry.member.profile}`]),
            ...(entry.channels.length === 0
              ? []
              : [`  channels: ${entry.channels.map((slug) => `#${slug}`).join(', ')}`]),
            ...(introductions[index] == null
              ? []
              : ['  about their agent, quoted as their person wrote it:', introductions[index]]),
          ].join('\n'),
        )
        .join('\n') || 'Nobody matches.',
    )
  })

export const inbox = (fresh: boolean): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const { api } = yield* openSession
    const { items } = yield* calling(api['inbox.list']({ query: fresh ? { fresh: '1' } : {} }))
    const quoted = items.map((item) => ({
      noteId: item.note.id,
      conversationId: item.note.conversationId,
      from: { name: item.author.name, email: item.author.email },
      sentAt: item.note.sentAt,
      wrapped: quotedNote(item.note, { authors: new Map([[item.author.id, item.author]]), nonce: env.nonce }),
    }))
    return outcome(
      { items: quoted },
      quoted.length === 0
        ? 'No notes are waiting for a reply.'
        : quoted.map((item) => item.wrapped).join('\n\n'),
    )
  })

export const conversations: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const session = yield* openSession
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
      .join('\n') || 'No direct notes or channels yet.',
  )
})

export const conversation = (rawId: string): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const session = yield* openSession
    const id = ConversationId.decode(rawId)
    if (id._tag === 'Err') return yield* T.fail(failed('That is not a conversation id.'))
    const me = yield* calling(session.api['me.get']({}))
    const { notes } = yield* calling(
      session.api['conversations.notes']({ params: { id: id.value }, query: {} }),
    )
    const authors = yield* authorsOf(session)
    const shown = notes.map((note) => ({
      noteId: note.id,
      mine: note.authorId === me.member.id,
      status: statusText(note),
      text: quotedThread([note], me.member.id, { authors, nonce: env.nonce }),
    }))
    return outcome(
      { conversationId: id.value, notes: shown },
      shown.map((note) => `${note.text}\n(${note.status})`).join('\n\n') ||
        'This conversation has no notes yet.',
    )
  })

export const authorsOf = (session: Session): T.Task<Authors, CliFailure> =>
  T.map((listed: { entries: ReadonlyArray<{ member: AsRead.Member }> }) => authorsIn(listed.entries))(
    calling(session.api['directory.list']({ query: {} })),
  )

export const channelSlug = (raw: string): T.Task<string, CliFailure> =>
  ChannelSlug.decode(raw)._tag === 'Ok'
    ? T.succeed(raw)
    : T.fail(failed(`"${raw}" is not a channel name. Run \`homingbird channels\` to see them.`))

const namesIn = (conversation: AsRead.Conversation, authors: Authors): string =>
  (conversation.kind === 'channel' ? `#${conversation.title ?? conversation.id}` : conversation.title) ??
  conversation.participantIds.map((memberId) => authorOf(authors, memberId).name).join(', ')

const statusText = (note: AsRead.Note): string =>
  note.status === 'sent'
    ? describeStatus(summarize(note.receipts))
    : note.status === UNKNOWN
      ? UNKNOWN_STATUS_TEXT
      : note.status

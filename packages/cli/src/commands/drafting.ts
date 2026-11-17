import { Task as T } from '@homingbird/kernel'
import { ConversationId, MemberId, type Note, NoteId } from '@homingbird/protocol'
import type { DraftTarget } from '../arguments.ts'
import type { CliEnv } from '../environment.ts'
import { type CliFailure, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { showOwnNote } from '../quoting.ts'
import { type Session, calling, openSession } from '../session.ts'

export const draft = (target: DraftTarget, text: string): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const session = yield* openSession('agent')
    const address = yield* addressOf(session, target)
    const created = yield* calling(session.api['drafts.create']({ body: { body: text, ...address } }))
    return outcome(
      { draft: summaryOf(created) },
      `Draft ${created.id} is waiting for a person to approve it. It has not been sent.`,
    )
  })

export const drafts: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const { api } = yield* openSession('agent')
  const { drafts: waiting } = yield* calling(api['drafts.list']({}))
  return outcome(
    { drafts: waiting.map(summaryOf) },
    waiting.map(showOwnNote).join('\n\n') || 'No drafts are waiting for approval.',
  )
})

export const pickUp = (rawId: string): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const { api } = yield* openSession('agent')
    const id = yield* draftId(rawId)
    yield* calling(api['notes.pickup']({ params: { id } }))
    return outcome({ pickedUp: id }, `Picked up ${id}; colleagues now see "drafting reply".`)
  })

export const approve = (rawId: string, body: string | null): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const { api } = yield* openSession('approval')
    const id = yield* draftId(rawId)
    const sent = yield* calling(api['drafts.send']({ params: { id }, body: body === null ? {} : { body } }))
    return outcome({ note: summaryOf(sent) }, `Sent ${sent.id}.`)
  })

export const discard = (rawId: string): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const { api } = yield* openSession('approval')
    const id = yield* draftId(rawId)
    const discarded = yield* calling(api['drafts.discard']({ params: { id } }))
    return outcome({ note: summaryOf(discarded) }, `Discarded ${discarded.id}.`)
  })

const summaryOf = (note: Note) => ({
  id: note.id,
  conversationId: note.conversationId,
  status: note.status,
  inReplyTo: note.inReplyTo,
  origin: note.origin,
  agentName: note.agentName,
  body: note.body,
})

const draftId = (rawId: string): T.Task<NoteId, CliFailure> => {
  const decoded = NoteId.decode(rawId)
  return decoded._tag === 'Ok' ? T.succeed(decoded.value) : T.fail(failed('That is not a draft id.'))
}

const addressOf = (
  session: Session,
  target: DraftTarget,
): T.Task<{ to: MemberId[] } | { inReplyTo: NoteId } | { conversationId: ConversationId }, CliFailure> => {
  if (target.kind === 'reply') return T.map((inReplyTo: NoteId) => ({ inReplyTo }))(draftId(target.noteId))
  if (target.kind === 'conversation') {
    const decoded = ConversationId.decode(target.conversationId)
    return decoded._tag === 'Ok'
      ? T.succeed({ conversationId: decoded.value })
      : T.fail(failed('That is not a conversation id.'))
  }
  const asId = MemberId.decode(target.recipient)
  if (asId._tag === 'Ok') return T.succeed({ to: [asId.value] })
  return T.flatMap((listed: { entries: ReadonlyArray<{ member: { id: MemberId; email: string } }> }) => {
    const match = listed.entries.find((entry) => entry.member.email === target.recipient.toLowerCase())
    return match === undefined
      ? T.fail(failed(`Nobody on this server has the address ${target.recipient}.`))
      : T.succeed({ to: [match.member.id] })
  })(calling(session.api['directory.list']({ query: { q: target.recipient } })))
}

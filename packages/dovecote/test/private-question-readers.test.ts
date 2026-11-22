import { Task as T } from '@homingbird/kernel'
import type { ConversationId, CredentialKind, Member, Note, NoteId, StreamEvent } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  inReadableRooms,
  readableEvents,
  readsPrivateQuestions,
  requireReadableRoom,
  requireReadableTarget,
  requireRoomForOwnAgent,
} from '../src/domain/private-question-readers.ts'
import type { Caller } from '../src/environment.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { type Session, type TestServer, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let lobby: ConversationId
let question: ConversationId
let questionNote: NoteId
let sentNote: Note

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'lobby' })
  ana = await server.signIn('ana@example.com', 'Ana')
  await ana.api('PUT', '/channels/lobby/membership', {})
  lobby = (await ana.api('GET', '/channels/lobby')).json.conversationId
  const asked = (await ana.api('POST', '/drafts', { channel: 'lobby', body: 'Where is the runbook?' })).json
  const sent = (
    await ana.api('POST', `/drafts/${asked.id}/send`, {
      expected: { body: asked.body, conversationId: asked.conversationId },
    })
  ).json
  questionNote = sent.id
  sentNote = sent
  question = 'conv_private000000' as ConversationId
  await T.runPromise(
    run(sql`INSERT INTO conversations (id, kind, title, created_at, last_activity_at, channel_id, asked_by)
      VALUES (${question}, 'group', NULL, 1, 1, ${lobby}, ${ana.me.member.id})`),
    server.env,
  )
  await T.runPromise(
    run(sql`UPDATE notes SET conversation_id = ${question} WHERE id = ${questionNote}`),
    server.env,
  )
})

afterEach(() => server?.close())

const running = <A>(task: T.Task<A, unknown, any>) => T.runPromise(T.result(task), server.env)

const callerOf = (kind: CredentialKind, memberKind: Member['kind'] = 'person'): Caller => ({
  member: { ...ana.me.member, kind: memberKind },
  credential: { id: 'cred_x' as never, kind, name: 'x' },
})

const event = (body: StreamEvent['body']): StreamEvent => ({ seq: 1, at: 1, body })

describe('who reads private questions', () => {
  it('lets a person signed in and a channel’s agent read them, and no person’s agent credential', () => {
    expect(readsPrivateQuestions(callerOf('human'))).toBe(true)
    expect(readsPrivateQuestions(callerOf('agent', 'channel_agent'))).toBe(true)
    expect(readsPrivateQuestions(callerOf('agent'))).toBe(false)
  })

  it('keeps out of an agent’s reach the items in private questions, in their order, and every item for a person', async () => {
    const items = [{ room: lobby }, { room: question }, { room: null }]
    expect(
      await T.runPromise(
        inReadableRooms(callerOf('agent'), items, (item) => item.room),
        server.env,
      ),
    ).toEqual([{ room: lobby }, { room: null }])
    expect(await running(inReadableRooms(callerOf('human'), items, (item) => item.room))).toMatchObject({
      value: items,
    })
    expect(
      await T.runPromise(
        inReadableRooms(callerOf('agent'), [], (item: { room: null }) => item.room),
        server.env,
      ),
    ).toEqual([])
  })

  it('answers a private question as a room that does not exist, to an agent only', async () => {
    expect(await running(requireReadableRoom(callerOf('agent'), question))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'NotFound', message: 'No such conversation.' },
    })
    expect(await running(requireReadableRoom(callerOf('agent'), lobby))).toMatchObject({ _tag: 'Ok' })
    expect(await running(requireReadableRoom(callerOf('human'), question))).toMatchObject({ _tag: 'Ok' })
  })

  it('refuses an agent’s draft into a private question or in reply to a note there, and nothing else', async () => {
    const agent = callerOf('agent')
    for (const target of [{ conversationId: question }, { inReplyTo: questionNote }])
      expect(await running(requireReadableTarget(agent, target))).toMatchObject({ _tag: 'Err' })
    for (const target of [{}, { conversationId: lobby }, { inReplyTo: 'note_unknown0000' as NoteId }])
      expect(await running(requireReadableTarget(agent, target))).toMatchObject({ _tag: 'Ok' })
    expect(
      await running(requireReadableTarget(callerOf('human'), { conversationId: question })),
    ).toMatchObject({
      _tag: 'Ok',
    })
  })

  it('refuses a person’s agent a draft request in a private question, and takes it anywhere else', async () => {
    expect(await running(requireRoomForOwnAgent(question))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Conflict', message: expect.stringContaining('cannot read a private question') },
    })
    expect(await running(requireRoomForOwnAgent(lobby))).toMatchObject({ _tag: 'Ok' })
  })

  it('drops an agent’s events about a private question, whichever way the event names its room', async () => {
    const note = { ...sentNote, conversationId: question }
    const request = {
      id: 'dreq_1',
      conversationId: question,
      inReplyTo: null,
      instruction: '',
      agentId: null,
      createdAt: 1,
      expiresAt: 2,
      cancelledAt: null,
      draftIds: [],
    }
    const hidden = [
      event({ type: 'note.sent', note }),
      event({ type: 'draft.saved', note }),
      event({ type: 'draft.requested', request } as never),
      event({ type: 'draft.request.changed', request } as never),
      event({ type: 'note.withdrawn', noteId: questionNote, conversationId: question }),
    ]
    const kept = [
      event({ type: 'note.withdrawn', noteId: questionNote, conversationId: lobby }),
      event({ type: 'proposals.changed' }),
      event({ type: 'preview.changed', conversationId: null }),
    ]
    const read = await T.runPromise(readableEvents(callerOf('agent'), [...hidden, ...kept]), server.env)
    expect(read).toEqual(kept)
  })
})

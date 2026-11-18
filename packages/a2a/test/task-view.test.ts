import { Task as T } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import { ConversationKind, Note, NoteId, Unavailable, WRAPPER_TAG } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { TaskPhase } from '../src/dialect.ts'
import { memberApiOf } from '../src/member-api.ts'
import { taskViewOf } from '../src/task-view.ts'
import {
  ANA,
  BEN,
  CHANNEL_CONVERSATION_ID,
  DIRECTORY,
  JUNE,
  type Stubs,
  channelConversationOf,
  conversationOf,
  fakeApi,
  noteOf,
  receiptOf,
  sequentialNonce,
} from './support.ts'

const viewing = async (note: Note, stubs: Stubs = {}) => {
  const fake = fakeApi(stubs)
  const exit = await T.run(
    T.result(
      taskViewOf(note, {
        api: memberApiOf(fake.api),
        publicUrl: 'https://hb.example.com',
        nonce: sequentialNonce(),
      }),
    ),
  )
  if (exit._tag === 'Err') throw new Error('taskViewOf died')
  return { result: exit.value, calls: fake.calls }
}

const view = async (note: Note, stubs: Stubs = {}) => {
  const { result, calls } = await viewing(note, stubs)
  if (result._tag === 'Err') throw new Error(`taskViewOf failed: ${JSON.stringify(result.error)}`)
  return { view: result.value, calls }
}

const QUESTION = noteOf({ authorId: ANA.id, receipts: [receiptOf({ memberId: BEN.id })] })
const REPLY_ID = NoteId.of('reply0000000')
const REPLIED = noteOf({
  authorId: ANA.id,
  updatedAt: 10,
  receipts: [receiptOf({ memberId: BEN.id, state: 'replied', repliedAt: 50 })],
})
const reply = (overrides: Partial<Note> = {}) =>
  noteOf({
    id: REPLY_ID,
    authorId: BEN.id,
    inReplyTo: REPLIED.id,
    body: 'Yes, go ahead.',
    sentAt: 50,
    ...overrides,
  })

describe('taskViewOf', () => {
  it('shows a draft as waiting for the member’s human, and says where they approve', async () => {
    const draft = noteOf({ status: 'draft', sentAt: null, receipts: [], updatedAt: 42 })
    const { view: shown, calls } = await view(draft)
    expect(shown).toMatchObject({
      id: draft.id,
      contextId: draft.conversationId,
      phase: 'input_required',
      updatedAt: 42,
      artifacts: [],
      metadata: { noteStatus: 'draft', origin: 'agent' },
    })
    expect(shown.statusText).toContain('not sent')
    expect(shown.statusText).toContain('https://hb.example.com')
    expect(calls).toEqual([])
  })

  it('shows a discarded draft as canceled', async () => {
    const { view: shown } = await view(noteOf({ status: 'discarded', sentAt: null, receipts: [] }))
    expect(shown).toMatchObject({ phase: 'canceled', artifacts: [] })
    expect(shown.statusText).toMatch(/discarded.*never sent/i)
  })

  it('shows a sent note nobody answered as working, without reading the conversation', async () => {
    const { view: shown, calls } = await view(QUESTION)
    expect(shown).toMatchObject({
      phase: 'working',
      statusText: 'Approved and sent. Delivered.',
      artifacts: [],
      updatedAt: QUESTION.updatedAt,
    })
    expect(calls).toEqual([])
  })

  it('completes once every recipient replied, with each reply as a wrapped artifact', async () => {
    const { view: shown, calls } = await view(REPLIED, {
      'conversations.get': () => conversationOf(),
      'conversations.notes': () => ({
        notes: [
          REPLIED,
          reply(),
          reply({ id: NoteId.of('draft0000000'), status: 'draft', body: 'never shown' }),
          reply({ id: NoteId.of('other0000000'), inReplyTo: null, body: 'unrelated' }),
        ],
        hasMore: false,
        notices: [],
      }),
      'directory.list': () => DIRECTORY,
    })
    expect(shown.phase).toBe('completed')
    expect(shown.updatedAt).toBe(50)
    expect(shown.statusText).toBe('Approved and sent. Replied.')
    expect(shown.artifacts).toHaveLength(1)
    expect(shown.artifacts[0]).toMatchObject({ id: REPLY_ID, name: 'Reply from Ben' })
    expect(shown.artifacts[0]!.text).toMatch(
      new RegExp(`^<${WRAPPER_TAG} id="${REPLY_ID}" from="Ben &lt;ben@example.com&gt;"`),
    )
    expect(shown.artifacts[0]!.text).toContain('Yes, go ahead.')
    expect(JSON.stringify(shown)).not.toContain('never shown')
    expect(calls.map((call) => call.name)).toEqual([
      'conversations.get',
      'conversations.notes',
      'directory.list',
    ])
    expect(calls[1]!.request).toEqual({ params: { id: REPLIED.conversationId }, query: { limit: '200' } })
  })

  it('stays working while only some recipients replied', async () => {
    const partly = noteOf({
      authorId: ANA.id,
      receipts: [
        receiptOf({ memberId: BEN.id, state: 'replied', repliedAt: 50 }),
        receiptOf({ memberId: NoteId.of('x') as never }),
      ],
    })
    const { view: shown } = await view(partly, {
      'conversations.get': () => conversationOf({ kind: 'group' }),
      'conversations.notes': () => ({
        notes: [reply({ inReplyTo: partly.id })],
        hasMore: false,
        notices: [],
      }),
      'directory.list': () => DIRECTORY,
    })
    expect(shown.phase).toBe('working')
    expect(shown.artifacts).toHaveLength(1)
  })

  it('names an author who left the directory as unknown', async () => {
    const { view: shown } = await view(REPLIED, {
      'conversations.get': () => conversationOf(),
      'conversations.notes': () => ({ notes: [reply()], hasMore: false, notices: [] }),
      'directory.list': () => ({ entries: [] }),
    })
    expect(shown.artifacts[0]!.name).toBe('Reply from Unknown member')
    expect(shown.artifacts[0]!.text).toContain('from="Unknown member &lt;unknown&gt;"')
  })

  it('completes a question to a channel once one helper replied, though the other helpers never will', async () => {
    const question = noteOf({
      authorId: ANA.id,
      conversationId: CHANNEL_CONVERSATION_ID,
      receipts: [
        receiptOf({ memberId: BEN.id }),
        receiptOf({ memberId: JUNE.id, state: 'replied', repliedAt: 70 }),
      ],
    })
    const { view: shown } = await view(question, {
      'conversations.get': () => channelConversationOf(),
      'conversations.notes': () => ({
        notes: [
          reply({ authorId: JUNE.id, inReplyTo: question.id, conversationId: CHANNEL_CONVERSATION_ID }),
        ],
        hasMore: false,
        notices: [],
      }),
      'directory.list': () => DIRECTORY,
    })
    expect(shown.phase).toBe('completed')
    expect(shown.contextId).toBe(CHANNEL_CONVERSATION_ID)
    expect(shown.artifacts).toHaveLength(1)
    expect(shown.artifacts[0]!.name).toBe('Reply from June')
    expect(shown.artifacts[0]!.text).toMatch(new RegExp(`^<${WRAPPER_TAG} `))
  })

  it('fails when the conversation cannot be read', async () => {
    const { result } = await viewing(REPLIED, {
      'conversations.get': () => conversationOf(),
      'conversations.notes': () => Unavailable({ message: 'down' }),
    })
    expect(result).toEqual({ _tag: 'Err', error: Unavailable({ message: 'down' }) })
    const { result: unknownConversation } = await viewing(REPLIED, {
      'conversations.get': () => Unavailable({ message: 'gone' }),
    })
    expect(unknownConversation).toEqual({ _tag: 'Err', error: Unavailable({ message: 'gone' }) })
  })

  it('maps every possible note to exactly one phase, by status, replies and conversation kind', async () => {
    const expectedPhase = (note: Note, kind: ConversationKind): TaskPhase => {
      if (note.status === 'draft') return 'input_required'
      if (note.status === 'discarded') return 'canceled'
      const replied = note.receipts.filter((receipt) => receipt.repliedAt !== null)
      if (replied.length === 0) return 'working'
      return kind === 'channel' || replied.length === note.receipts.length ? 'completed' : 'working'
    }
    await fc.assert(
      fc.asyncProperty(
        arbitrary(Note),
        arbitrary(ConversationKind),
        fc.string({ minLength: 1, maxLength: 60 }),
        async (note, kind, replyBody) => {
          const { view: shown } = await view(note, {
            'conversations.get': () => conversationOf({ kind }),
            'conversations.notes': () => ({
              notes: [reply({ inReplyTo: note.id, body: replyBody })],
              hasMore: false,
              notices: [],
            }),
            'directory.list': () => DIRECTORY,
          })
          expect(shown.phase).toBe(expectedPhase(note, kind))
          expect(shown.id).toBe(note.id)
          if (note.status !== 'sent') expect(shown.artifacts).toEqual([])
          for (const artifact of shown.artifacts) {
            expect(artifact.text.startsWith(`<${WRAPPER_TAG} `)).toBe(true)
            expect(artifact.text.endsWith(`</${WRAPPER_TAG}>`)).toBe(true)
          }
          expect(shown.statusText).not.toContain(note.body.length > 20 ? note.body : '\u0000')
        },
      ),
      { numRuns: 150 },
    )
  })
})

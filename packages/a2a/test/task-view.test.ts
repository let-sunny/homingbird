import { Task as T } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import { Note, NoteId, Unavailable, WRAPPER_TAG } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { TaskPhase } from '../src/dialect.ts'
import { memberApiOf } from '../src/member-api.ts'
import { taskViewOf } from '../src/task-view.ts'
import { ANA, BEN, DIRECTORY, type Stubs, fakeApi, noteOf, receiptOf, sequentialNonce } from './support.ts'

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
  noteOf({ id: REPLY_ID, authorId: BEN.id, inReplyTo: REPLIED.id, body: 'Yes, go ahead.', sentAt: 50, ...overrides })

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
      'conversations.notes': () => ({
        notes: [
          REPLIED,
          reply(),
          reply({ id: NoteId.of('draft0000000'), status: 'draft', body: 'never shown' }),
          reply({ id: NoteId.of('other0000000'), inReplyTo: null, body: 'unrelated' }),
        ],
        hasMore: false,
      }),
      'directory.list': () => DIRECTORY,
    })
    expect(shown.phase).toBe('completed')
    expect(shown.updatedAt).toBe(50)
    expect(shown.statusText).toBe('Approved and sent. Replied.')
    expect(shown.artifacts).toHaveLength(1)
    expect(shown.artifacts[0]).toMatchObject({ id: REPLY_ID, name: 'Reply from Ben' })
    expect(shown.artifacts[0]!.text).toMatch(new RegExp(`^<${WRAPPER_TAG} id="${REPLY_ID}" from="Ben &lt;ben@example.com&gt;"`))
    expect(shown.artifacts[0]!.text).toContain('Yes, go ahead.')
    expect(JSON.stringify(shown)).not.toContain('never shown')
    expect(calls.map((call) => call.name)).toEqual(['conversations.notes', 'directory.list'])
    expect(calls[0]!.request).toEqual({ params: { id: REPLIED.conversationId }, query: { limit: '200' } })
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
      'conversations.notes': () => ({ notes: [reply({ inReplyTo: partly.id })], hasMore: false }),
      'directory.list': () => DIRECTORY,
    })
    expect(shown.phase).toBe('working')
    expect(shown.artifacts).toHaveLength(1)
  })

  it('names an author who left the directory as unknown', async () => {
    const { view: shown } = await view(REPLIED, {
      'conversations.notes': () => ({ notes: [reply()], hasMore: false }),
      'directory.list': () => ({ entries: [] }),
    })
    expect(shown.artifacts[0]!.name).toBe('Reply from Unknown member')
    expect(shown.artifacts[0]!.text).toContain('from="Unknown member &lt;unknown&gt;"')
  })

  it('fails when the conversation cannot be read', async () => {
    const { result } = await viewing(REPLIED, {
      'conversations.notes': () => Unavailable({ message: 'down' }),
    })
    expect(result).toEqual({ _tag: 'Err', error: Unavailable({ message: 'down' }) })
  })

  it('maps every possible note to exactly one phase, by status and replies alone', async () => {
    const expectedPhase = (note: Note): TaskPhase =>
      note.status === 'draft'
        ? 'input_required'
        : note.status === 'discarded'
          ? 'canceled'
          : note.receipts.length > 0 && note.receipts.every((receipt) => receipt.repliedAt !== null)
            ? 'completed'
            : 'working'
    await fc.assert(
      fc.asyncProperty(arbitrary(Note), fc.string({ minLength: 1, maxLength: 60 }), async (note, replyBody) => {
        const { view: shown } = await view(note, {
          'conversations.notes': () => ({
            notes: [reply({ inReplyTo: note.id, body: replyBody })],
            hasMore: false,
          }),
          'directory.list': () => DIRECTORY,
        })
        expect(shown.phase).toBe(expectedPhase(note))
        expect(shown.id).toBe(note.id)
        if (note.status !== 'sent') expect(shown.artifacts).toEqual([])
        for (const artifact of shown.artifacts) {
          expect(artifact.text.startsWith(`<${WRAPPER_TAG} `)).toBe(true)
          expect(artifact.text.endsWith(`</${WRAPPER_TAG}>`)).toBe(true)
        }
        expect(shown.statusText).not.toContain(note.body.length > 20 ? note.body : '\u0000')
      }),
      { numRuns: 150 },
    )
  })
})

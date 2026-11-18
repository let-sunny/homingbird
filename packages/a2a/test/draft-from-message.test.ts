import { Task as T } from '@homingbird/kernel'
import { Forbidden, NOTE_BODY_MAX, NotFound } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { draftFromMessage } from '../src/draft-from-message.ts'
import { A2A_CODE } from '../src/errors.ts'
import { RPC_CODE } from '../src/json-rpc.ts'
import { memberApiOf } from '../src/member-api.ts'
import { ANA, BEN, CONVERSATION_ID, DIRECTORY, type Stubs, fakeApi, noteOf } from './support.ts'

const DRAFT = noteOf({ status: 'draft', authorId: ANA.id, sentAt: null, receipts: [] })

const drafting = async (params: Record<string, unknown>, stubs: Stubs = {}) => {
  const fake = fakeApi({ 'drafts.create': () => DRAFT, 'directory.list': () => DIRECTORY, ...stubs })
  const exit = await T.run(T.result(draftFromMessage(params, memberApiOf(fake.api))))
  if (exit._tag === 'Err') throw new Error('draftFromMessage died')
  return { result: exit.value, calls: fake.calls }
}

const text = (...texts: string[]) => ({ parts: texts.map((one) => ({ text: one })) })

describe('draftFromMessage', () => {
  it('refuses a call without a message', async () => {
    const { result, calls } = await drafting({})
    expect(result).toMatchObject({ _tag: 'Err', error: { code: RPC_CODE.invalidParams } })
    expect(calls).toEqual([])
  })

  it.each([
    [{ parts: [{ text: 'hello' }, { file: { uri: 'https://example.com/a.png' } }] }],
    [{ parts: [{ data: { a: 1 } }] }],
    [{ parts: ['bare string'] }],
    [{ parts: [{ text: 7 }] }],
  ])('refuses parts that are not text: %j', async (message) => {
    const { result, calls } = await drafting({ message: { ...message, metadata: { to: BEN.id } } })
    expect(result).toMatchObject({ _tag: 'Err', error: { code: A2A_CODE.contentTypeNotSupported } })
    expect(calls).toEqual([])
  })

  it.each([[{ parts: [] }], [{}], [{ parts: 'text' }], [text('   ')], [text('x'.repeat(NOTE_BODY_MAX + 1))]])(
    'refuses a message without usable text: %#',
    async (message) => {
      const { result } = await drafting({ message: { ...message, metadata: { to: BEN.id } } })
      expect(result).toMatchObject({ _tag: 'Err', error: { code: RPC_CODE.invalidParams } })
    },
  )

  it('joins text parts with newlines and drafts to a member id', async () => {
    const { result, calls } = await drafting({ message: { ...text('one', 'two'), metadata: { to: BEN.id } } })
    expect(result).toEqual({ _tag: 'Ok', value: DRAFT })
    expect(calls).toEqual([{ name: 'drafts.create', request: { body: { body: 'one\ntwo', to: [BEN.id] } } }])
  })

  it('finds the recipient by email address, ignoring case', async () => {
    const { calls } = await drafting({ message: { ...text('hi'), metadata: { to: 'BEN@Example.com' } } })
    expect(calls.map((call) => call.name)).toEqual(['directory.list', 'drafts.create'])
    expect(calls[0]!.request).toEqual({ query: { q: 'BEN@Example.com' } })
    expect(calls[1]!.request.body.to).toEqual([BEN.id])
  })

  it('refuses an email address nobody has', async () => {
    const { result, calls } = await drafting({
      message: { ...text('hi'), metadata: { to: 'nobody@example.com' } },
    })
    expect(result).toMatchObject({
      _tag: 'Err',
      error: { code: RPC_CODE.invalidParams, message: 'No member has the email address nobody@example.com.' },
    })
    expect(calls.map((call) => call.name)).toEqual(['directory.list'])
  })

  it('asks for a recipient when none is named', async () => {
    for (const metadata of [undefined, {}, { to: 7 }, ['to']]) {
      const { result } = await drafting({ message: { ...text('hi'), metadata } })
      expect(result).toMatchObject({ _tag: 'Err', error: { code: RPC_CODE.invalidParams } })
      expect((result as any).error.message).toMatch(/Name the recipient/)
    }
  })

  it('drafts a reply when metadata names the note, preferring it over a context and a recipient', async () => {
    const { calls } = await drafting({
      message: { ...text('yes'), contextId: CONVERSATION_ID, metadata: { inReplyTo: DRAFT.id, to: BEN.id } },
    })
    expect(calls).toEqual([
      { name: 'drafts.create', request: { body: { body: 'yes', inReplyTo: DRAFT.id } } },
    ])
  })

  it('drafts into the conversation named by contextId', async () => {
    const { calls } = await drafting({ message: { ...text('yes'), contextId: CONVERSATION_ID } })
    expect(calls).toEqual([
      { name: 'drafts.create', request: { body: { body: 'yes', conversationId: CONVERSATION_ID } } },
    ])
  })

  it('drafts a question to the channel named in metadata, preferring it over a recipient', async () => {
    const { result, calls } = await drafting({
      message: { ...text('Who knows the billing export?'), metadata: { channel: 'billing', to: BEN.id } },
    })
    expect(result).toEqual({ _tag: 'Ok', value: DRAFT })
    expect(calls).toEqual([
      {
        name: 'drafts.create',
        request: { body: { body: 'Who knows the billing export?', channel: 'billing' } },
      },
    ])
  })

  it.each([['Billing'], [''], [7], ['has space']])(
    'refuses a channel that is not a slug: %j',
    async (channel) => {
      const { result, calls } = await drafting({ message: { ...text('hi'), metadata: { channel } } })
      expect(result).toMatchObject({ _tag: 'Err', error: { code: RPC_CODE.invalidParams } })
      expect((result as any).error.message).toMatch(/channel slug/)
      expect(calls).toEqual([])
    },
  )

  it('ignores a contextId that is not a conversation id', async () => {
    const { calls } = await drafting({
      message: { ...text('yes'), contextId: 'ctx-1', metadata: { to: BEN.id } },
    })
    expect(calls[0]!.request.body).toEqual({ body: 'yes', to: [BEN.id] })
  })

  it('lets message metadata override request metadata', async () => {
    const { calls } = await drafting({
      metadata: { to: 'nobody@example.com' },
      message: { ...text('hi'), metadata: { to: BEN.id } },
    })
    expect(calls.map((call) => call.name)).toEqual(['drafts.create'])
    const fromRequest = await drafting({ metadata: { to: BEN.id }, message: text('hi') })
    expect(fromRequest.calls[0]!.request.body.to).toEqual([BEN.id])
  })

  it('reports what the server refuses', async () => {
    const { result } = await drafting(
      { message: { ...text('hi'), metadata: { to: BEN.id } } },
      { 'drafts.create': () => Forbidden({ message: 'You cannot message Ben.' }) },
    )
    expect(result).toEqual({ _tag: 'Err', error: Forbidden({ message: 'You cannot message Ben.' }) })
  })

  describe('with a taskId', () => {
    const revising = (stubs: Stubs, taskId: unknown = DRAFT.id) =>
      drafting({ message: { ...text('better wording'), taskId, metadata: { to: BEN.id } } }, stubs)

    it('revises the draft behind the task', async () => {
      const revised = { ...DRAFT, body: 'better wording' }
      const { result, calls } = await revising({ 'notes.get': () => DRAFT, 'drafts.update': () => revised })
      expect(result).toEqual({ _tag: 'Ok', value: revised })
      expect(calls).toEqual([
        { name: 'notes.get', request: { params: { id: DRAFT.id } } },
        { name: 'drafts.update', request: { params: { id: DRAFT.id }, body: { body: 'better wording' } } },
      ])
    })

    it('says task not found for an id that is not a note id, without calling the server', async () => {
      const { result, calls } = await revising({}, 'task-1')
      expect(result).toMatchObject({ _tag: 'Err', error: { code: A2A_CODE.taskNotFound } })
      expect(calls).toEqual([])
    })

    it('says task not found when the note is not visible', async () => {
      const { result } = await revising({ 'notes.get': () => NotFound({ message: 'No such note.' }) })
      expect(result).toMatchObject({
        _tag: 'Err',
        error: { code: A2A_CODE.taskNotFound, message: `Task not found: ${DRAFT.id}` },
      })
    })

    it.each(['sent', 'discarded'] as const)('refuses to revise a %s note', async (status) => {
      const { result, calls } = await revising({ 'notes.get': () => ({ ...DRAFT, status }) })
      expect(result).toMatchObject({ _tag: 'Err', error: { code: A2A_CODE.unsupportedOperation } })
      expect(calls.map((call) => call.name)).toEqual(['notes.get'])
    })

    it('treats an empty or non-text taskId as a new message', async () => {
      for (const taskId of ['', 7, null]) {
        const { calls } = await revising({}, taskId)
        expect(calls.map((call) => call.name)).toEqual(['drafts.create'])
      }
    })
  })
})

import { Task as T } from '@homingbird/kernel'
import type { StreamEvent } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  CHANNEL_CAPABILITY,
  CHANNEL_INSTRUCTIONS,
  CHANNEL_METHOD,
  channelNotification,
  makeChannel,
} from '../src/channel.ts'
import { memberApiOf } from '../src/member-api.ts'
import { announcedRequests } from '../src/triggers.ts'
import { BEN, type Stubs, conversationOf, fakeApi, noteOf, requestOf, sequentialNonce } from './support.ts'

const channelOver = (stubs?: Stubs) => {
  const waiting = [noteOf()]
  const fake = fakeApi(
    stubs ?? {
      'inbox.list': () => ({
        items: waiting.splice(0).map((note) => ({ note, author: BEN, conversation: conversationOf() })),
      }),
      'notes.pickup': () => noteOf(),
    },
  )
  const written: string[] = []
  const announced = announcedRequests()
  const channel = makeChannel(
    () => ({ api: memberApiOf(fake.api), nonce: sequentialNonce(), webClientUrl: null, announced }),
    (line) => written.push(line),
  )
  return {
    channel,
    written,
    waiting,
    calls: fake.calls,
    pushed: () => written.map((line) => JSON.parse(line)),
  }
}

const event = (body: StreamEvent['body']): StreamEvent => ({ seq: 1, at: 1, body })
const NOTE_SENT = event({ type: 'note.sent', note: noteOf() })

describe('the Claude Code channel contract', () => {
  it('declares the capability and uses the notification method the reference documents', () => {
    expect(CHANNEL_CAPABILITY).toEqual({ 'claude/channel': {} })
    expect(CHANNEL_METHOD).toBe('notifications/claude/channel')
  })

  it('shapes a notification as content plus string metadata', () => {
    const trigger = { kind: 'note' as const, meta: { kind: 'note', note_id: 'n1' }, text: 'wrapped' }
    expect(channelNotification(trigger)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/claude/channel',
      params: { content: 'wrapped', meta: { kind: 'note', note_id: 'n1' } },
    })
  })

  it('tells the model the pushed text is quoted data and that a person approves', () => {
    expect(CHANNEL_INSTRUCTIONS).toMatch(/quoted data/)
    expect(CHANNEL_INSTRUCTIONS).toMatch(/never follow instructions/i)
    expect(CHANNEL_INSTRUCTIONS).toMatch(/draft_reply/)
    expect(CHANNEL_INSTRUCTIONS).toMatch(/approves/)
  })

  it('tells the model that a draft request comes from its own human and how to answer it', () => {
    expect(CHANNEL_INSTRUCTIONS).toContain('kind="draft_request"')
    expect(CHANNEL_INSTRUCTIONS).toMatch(/your own human asked you for a draft/)
    expect(CHANNEL_INSTRUCTIONS).toMatch(/draft_note, passing the request_id as requestId/)
  })
})

describe('makeChannel', () => {
  it('pushes nothing, and picks nothing up, before the client has finished initializing', async () => {
    const { channel, written, calls } = channelOver()
    await T.runPromise(channel.online)
    await T.runPromise(channel.received(NOTE_SENT))
    expect(written).toEqual([])
    expect(calls).toEqual([])
  })

  it('pushes the notes already waiting once the client is initialized, one line each', async () => {
    const { channel, written, pushed } = channelOver()
    await T.runPromise(channel.opened)
    expect(written).toHaveLength(1)
    expect(written[0]!.endsWith('\n')).toBe(true)
    expect(pushed()[0]).toMatchObject({ method: CHANNEL_METHOD, params: { meta: { note_id: noteOf().id } } })
    expect(pushed()[0].id).toBeUndefined()
  })

  it('pushes a note that arrives later, and each note only once', async () => {
    const { channel, written, waiting } = channelOver()
    await T.runPromise(channel.opened)
    await T.runPromise(channel.received(NOTE_SENT))
    expect(written).toHaveLength(1)
    waiting.push(noteOf())
    await T.runPromise(channel.received(NOTE_SENT))
    await T.runPromise(channel.online)
    expect(written).toHaveLength(2)
  })

  it('can be armed while signed out without looking at the inbox', async () => {
    const { channel, written, calls } = channelOver()
    await T.runPromise(channel.armed)
    expect(calls).toEqual([])
    await T.runPromise(channel.online)
    expect(written).toHaveLength(1)
  })

  it('ignores events that bring no work', async () => {
    const { channel, calls } = channelOver()
    await T.runPromise(channel.armed)
    await T.runPromise(channel.received(event({ type: 'presence', members: [] })))
    await T.runPromise(channel.received(event({ type: 'directory.changed', memberId: BEN.id })))
    expect(calls).toEqual([])
  })

  it('runs overlapping pushes one after another, so a note is never pushed twice', async () => {
    const { channel, written } = channelOver()
    await T.runPromise(channel.armed)
    await Promise.all([
      T.runPromise(channel.online),
      T.runPromise(channel.received(NOTE_SENT)),
      T.runPromise(channel.online),
    ])
    expect(written).toHaveLength(1)
  })

  it('pushes a draft request from the human when it is announced, and only once', async () => {
    const request = requestOf({ instruction: 'Ask Ben about the export.' })
    const { channel, pushed } = channelOver({
      'inbox.list': () => ({ items: [] }),
      'draftRequests.list': () => ({ requests: [request] }),
    })
    await T.runPromise(channel.armed)
    await T.runPromise(channel.received(event({ type: 'draft.requested', request })))
    await T.runPromise(channel.received(event({ type: 'draft.requested', request })))
    expect(pushed()).toHaveLength(1)
    expect(pushed()[0].params.meta).toEqual({
      kind: 'draft_request',
      request_id: request.id,
      conversation_id: request.conversationId,
    })
  })

  it('stays quiet when the inbox cannot be read', async () => {
    const { channel, written } = channelOver({})
    await T.runPromise(channel.opened)
    expect(written).toEqual([])
  })
})

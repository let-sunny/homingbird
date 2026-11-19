import type { DraftRequest } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { bodyToSend, composerModel } from '../../src/models/composer.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, ROOM, conversation, entry, note, serverInfo } from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

const request = (fields: Partial<DraftRequest> = {}): DraftRequest => ({
  id: 'dreq_000000000001' as never,
  conversationId: ROOM,
  inReplyTo: null,
  instruction: '',
  agentId: null,
  createdAt: 1,
  expiresAt: 1_000,
  cancelledAt: null,
  draftIds: [],
  ...fields,
})

describe('composerModel', () => {
  it('explains that an archived room takes no notes', () => {
    expect(composerModel(threadInput({ conversations: [conversation({ archivedAt: 5 })] }))).toEqual({
      kind: 'archived',
      notice: strings.archivedRoomNotice,
    })
  })

  it('is open and quiet with nothing going on', () => {
    expect(composerModel(threadInput())).toEqual({
      kind: 'open',
      blocked: null,
      sending: null,
      asked: [],
      noAgent: null,
      replyingTo: null,
      asksAgent: true,
    })
  })

  it('shows a note on its way, the request to the agent, and that the agent is not awake', () => {
    const model = composerModel(
      threadInput({
        sending: true,
        draftRequests: [request(), request({ id: 'dreq_000000000002' as never, instruction: 'Say yes' })],
        directory: [entry(ANA, 'Ana')],
      }),
    )
    if (model.kind !== 'open') throw new Error('expected an open composer')
    expect(model.sending).toMatchObject({
      text: strings.sending,
      avatar: { state: 'sending', motion: 'loop' },
    })
    expect(model.asked.map((asked) => asked.text)).toEqual([
      strings.askedAgent,
      strings.askedAgentFor({ instruction: 'Say yes' }),
    ])
    expect(model.noAgent).toEqual({
      text: strings.noAgentOnline,
      href: '#/agent/connection',
      link: strings.connectAgent,
    })
    const awake = composerModel(
      threadInput({
        draftRequests: [request()],
        directory: [entry(ANA, 'Ana', { presence: { humanOnline: true, agentOnline: true } })],
      }),
    )
    expect(awake.kind === 'open' && awake.noAgent).toBeNull()
  })

  it('leaves requests out while the organization has them off', () => {
    const model = composerModel(threadInput({ serverInfo: serverInfo(), draftRequests: [request()] }))
    expect(model).toMatchObject({ asked: [], asksAgent: false })
  })

  it('names the note answered, and why the person cannot write here', () => {
    const question = note('q', { body: 'When?' })
    const model = composerModel(
      threadInput({
        thread: { notes: [question], hasMore: false },
        replyTarget: 'q' as never,
        directory: [entry(BEN, 'Ben', { canMessage: false })],
        members: new Map(),
      }),
    )
    expect(model).toMatchObject({
      replyingTo: strings.replyingTo({ excerpt: 'When?' }),
      blocked: strings.cannotMessage,
    })
  })
})

describe('bodyToSend', () => {
  it('sends the text without its surrounding spaces, and nothing for blank text', () => {
    expect(bodyToSend('  Hello \n')).toBe('Hello')
    expect(bodyToSend(' \n ')).toBeNull()
  })
})

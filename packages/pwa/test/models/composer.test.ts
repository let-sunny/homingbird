import type { AsRead, DraftRequest } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { bodyToSend, composerModel } from '../../src/models/composer.ts'
import { formats, strings } from '../../src/strings.ts'
import { ANA, BEN, ROOM, channel, conversation, entry, note, serverInfo } from '../support/fixtures.ts'
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
      theirAgent: null,
      answers: null,
      replyingTo: null,
      postsTo: null,
      asksAgent: true,
      lookUpEarlierAnswers: true,
      askAgentReason: null,
    })
  })

  it('says why the person’s agent cannot be asked while their desk runs but it cannot answer', () => {
    const unavailable = entry(ANA, 'Ana', {
      presence: {
        humanOnline: true,
        agentOnline: true,
        agentUnavailable: { until: null, kind: 'signed_out' },
      },
    })
    expect(composerModel(threadInput({ directory: [unavailable] }))).toMatchObject({
      asksAgent: true,
      askAgentReason: strings.deskUnavailableReason.signed_out,
    })
    expect(composerModel(threadInput({ serverInfo: serverInfo() }))).toMatchObject({
      asksAgent: false,
      askAgentReason: null,
    })
  })

  it('says in a channel who answers before the question is sent, and warns when nobody can now', () => {
    const answers = (fields: Partial<AsRead.Channel>, directory: AsRead.DirectoryEntry[] = []) => {
      const model = composerModel(
        threadInput({
          conversations: [conversation({ kind: 'channel', title: 'billing' })],
          channels: [channel('billing', { conversationId: ROOM, ...fields })],
          directory,
        }),
      )
      return model.kind === 'open' ? model.answers : 'archived'
    }
    const helper = (presence: AsRead.Presence) => ({ id: BEN, name: 'Billing helper', presence })
    expect(answers({ agent: helper({ humanOnline: false, agentOnline: true }) })).toEqual({
      text: strings.channelAnswer.agentDrafts({ agent: 'Billing helper' }),
      warning: false,
    })
    expect(answers({ agent: helper({ humanOnline: false, agentOnline: false }) })).toEqual({
      text: strings.channelAnswer.agentNotConnected({ agent: 'Billing helper' }),
      warning: true,
    })
    expect(answers({ helperCount: 2 })).toEqual({
      text: strings.channelAnswer.peopleAnswer({ count: 2 }),
      warning: false,
    })
    const away = { humanOnline: false, agentOnline: false }
    expect(
      answers({ helperCount: 1 }, [entry(BEN, 'Ben', { presence: away, channels: ['billing'] })]),
    ).toEqual({ text: strings.channelAnswer.everyoneAway, warning: true })
    expect(answers({ helperCount: 0 })).toEqual({ text: strings.channelAnswer.nobodyAnswers, warning: true })
  })

  it('says before sending that the other person’s agent cannot answer, and until when when that is known', () => {
    const theirAgent = (presence: AsRead.Presence) => {
      const model = composerModel(threadInput({ directory: [entry(BEN, 'Ben', { presence })] }))
      return model.kind === 'open' ? model.theirAgent : 'archived'
    }
    expect(theirAgent({ humanOnline: true, agentOnline: true, agentUnavailable: { until: null } })).toBe(
      strings.theirAgentUnavailable,
    )
    const until = new Date(2026, 10, 21, 15, 0).getTime()
    expect(theirAgent({ humanOnline: false, agentOnline: true, agentUnavailable: { until } })).toBe(
      strings.theirAgentUnavailableUntil({ time: formats.time.format(new Date(until)) }),
    )
    expect(
      theirAgent({ humanOnline: true, agentOnline: false, agentUnavailable: { until: null } }),
    ).toBeNull()
    expect(theirAgent({ humanOnline: true, agentOnline: true })).toBeNull()
  })

  it('says nothing about agents that cannot answer in a group conversation', () => {
    const model = composerModel(
      threadInput({
        conversations: [conversation({ kind: 'group', participantIds: [ANA, BEN] })],
        directory: [
          entry(BEN, 'Ben', {
            presence: { humanOnline: true, agentOnline: true, agentUnavailable: { until: null } },
          }),
        ],
      }),
    )
    expect(model.kind === 'open' && model.theirAgent).toBeNull()
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

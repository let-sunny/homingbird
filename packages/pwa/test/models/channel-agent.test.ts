import type { AsRead, MemberId, NoteId } from '@homingbird/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import {
  agentAuthorshipLine,
  agentControlsModel,
  agentPanelModel,
  approvalLine,
  channelAgentPageModel,
  deviceTargetsModel,
  privateQuestionNotice,
  reviewCardsModel,
  reviewsWaitingModel,
} from '../../src/models/channel-agent.ts'
import { strings, useLanguage } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CY,
  channel,
  conversation,
  draft,
  everything,
  member,
  note,
  serverInfo,
} from '../support/fixtures.ts'

afterEach(() => useLanguage('en'))

const AGENT = 'mem_agent0000000' as MemberId
const wiki = channel('payments-wiki', { agent: { id: AGENT, name: 'Payments wiki' } })
const members = new Map<MemberId, AsRead.Member>([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
  [CY, member(CY, 'Cy')],
])

const review = (fields: Partial<AsRead.Review> = {}): AsRead.Review => ({
  note: draft('note_answer00000', {
    authorId: AGENT,
    inReplyTo: 'note_question000' as NoteId,
    basis: 'wiki/refunds.md',
  }),
  question: note('note_question000', { authorId: CY, body: 'Where is the runbook?' }),
  channel: 'payments-wiki',
  agent: member(AGENT, 'Payments wiki', { kind: 'channel_agent' }),
  privately: false,
  ...fields,
})

describe('agentControlsModel', () => {
  it('offers the panel to a manager in the room and asking privately to whoever may ask', () => {
    expect(agentControlsModel({ ...wiki, joined: true, runsAgent: true }, everything())).toEqual({
      manage: strings.channelAgent.title,
      askPrivately: 'Ask Payments wiki privately',
    })
    expect(agentControlsModel(wiki, everything())).toEqual({
      manage: null,
      askPrivately: 'Ask Payments wiki privately',
    })
  })

  it('offers nothing while channel agents are off, and no asking in a private channel one is not in', () => {
    expect(agentControlsModel({ ...wiki, joined: true, runsAgent: true }, serverInfo())).toEqual({
      manage: null,
      askPrivately: null,
    })
    expect(agentControlsModel({ ...wiki, visibility: 'private' }, everything()).askPrivately).toBeNull()
    expect(agentControlsModel(channel('quiet', { joined: true, runsAgent: true }), everything())).toEqual({
      manage: strings.channelAgent.title,
      askPrivately: null,
    })
  })
})

describe('agentPanelModel', () => {
  it('waits, then offers making an agent when there is none, or says it could not be loaded', () => {
    expect(agentPanelModel('loading', members)).toEqual({ kind: 'loading' })
    expect(agentPanelModel('failed', members)).toEqual({
      kind: 'failed',
      text: strings.channelAgent.loadFailed,
    })
    expect(agentPanelModel(null, members)).toMatchObject({
      kind: 'none',
      create: strings.channelAgent.create,
    })
  })

  it('shows each desk with who approved it, and whether it is still connected', () => {
    const credential: AsRead.ChannelAgent['credentials'][number] = {
      id: 'cred_desk00000000' as never,
      name: 'Wiki desk',
      client: 'homingbird',
      createdAt: 1,
      expiresAt: 2,
      lastUsedAt: null,
      revokedAt: null,
      issuedBy: ANA,
    }
    const panel = agentPanelModel(
      {
        agent: member(AGENT, 'Payments wiki', { kind: 'channel_agent' }),
        channel: 'payments-wiki',
        credentials: [
          credential,
          {
            ...credential,
            id: 'cred_old000000000' as never,
            revokedAt: 5,
            issuedBy: 'mem_gone00000000' as MemberId,
          },
          { ...credential, id: 'cred_none00000000' as never, issuedBy: null },
        ],
      },
      members,
    )
    expect(panel).toMatchObject({
      kind: 'agent',
      name: 'Payments wiki',
      desksNone: null,
      desks: [
        {
          name: 'Wiki desk',
          issuedBy: 'Approved by Ana',
          disconnect: strings.channelAgent.revoke,
          state: null,
        },
        {
          issuedBy: `Approved by ${strings.formerMember}`,
          disconnect: null,
          state: strings.channelAgent.revoked,
        },
        { issuedBy: null },
      ],
    })
    const empty = agentPanelModel(
      { agent: member(AGENT, 'Payments wiki'), channel: 'payments-wiki', credentials: [] },
      members,
    )
    expect(empty).toMatchObject({ desksNone: strings.channelAgent.desksNone })
  })
})

describe('reviewCardsModel', () => {
  it('shows the channel’s answers with their question, basis and whether they were asked privately', () => {
    const model = reviewCardsModel(
      [
        review(),
        review({ channel: 'elsewhere' }),
        review({ privately: true, question: null, note: draft('note_two', { basis: '' }) }),
      ],
      'payments-wiki',
      new Map(),
      members,
    )
    expect(model.none).toBeNull()
    expect(model.cards).toHaveLength(2)
    expect(model.cards[0]).toMatchObject({
      question: { from: 'Question from Cy', body: 'Where is the runbook?' },
      privately: null,
      basis: { lines: ['wiki/refunds.md'] },
      readAgain: null,
    })
    expect(model.cards[1]).toMatchObject({
      question: null,
      privately: strings.channelAgent.askedPrivately,
      basis: null,
    })
  })

  it('asks the manager to read an answer again when the agent changed it, and names a former asker', () => {
    const read = new Map([
      [review().note.id, { body: 'What it said first', conversationId: review().note.conversationId }],
    ])
    const changed = reviewCardsModel(
      [review({ question: note('note_q', { authorId: 'mem_gone00000000' as MemberId }) })],
      'payments-wiki',
      read,
      members,
    )
    expect(changed.cards[0]!.readAgain).toEqual({
      notice: strings.draftChangedSinceRead,
      confirm: strings.draftReadAgain,
    })
    expect(changed.cards[0]!.question!.from).toBe(`Question from ${strings.formerMember}`)
    expect(reviewCardsModel([], 'payments-wiki', new Map(), members).none).toBe(
      strings.channelAgent.reviewsNone,
    )
  })

  it('counts the answers waiting and leads to each channel they wait in', () => {
    expect(reviewsWaitingModel([])).toBeNull()
    expect(reviewsWaitingModel([review(), review(), review({ channel: 'ops' })])).toEqual({
      text: '3 answers are waiting for you',
      links: [
        { href: '#/channel/payments-wiki/agent', label: 'Review in #payments-wiki' },
        { href: '#/channel/ops/agent', label: 'Review in #ops' },
      ],
    })
    useLanguage('ko')
    expect(reviewsWaitingModel([review()])?.text).toBe('답 1개가 기다리고 있어요')
  })
})

describe('approvalLine', () => {
  const room = conversation({ id: wiki.conversationId, kind: 'channel' })

  it('names the channel and the manager who approved an agent’s answer', () => {
    const sent = note('note_answer', { authorId: AGENT, approvedBy: ANA })
    expect(approvalLine(sent, room, [wiki], members)).toBe('#payments-wiki · approved by Ana')
    const asked = conversation({ kind: 'group', privateQuestionOf: 'payments-wiki' })
    expect(approvalLine(sent, asked, [], members)).toBe('#payments-wiki · approved by Ana')
    expect(approvalLine(sent, conversation(), [], new Map())).toBe(`Approved by ${strings.formerMember}`)
  })

  it('says nothing about a note a person sent, or before its room is known', () => {
    expect(approvalLine(note('note_plain'), room, [wiki], members)).toBeNull()
    expect(approvalLine(note('note_x', { approvedBy: ANA }), undefined, [wiki], members)).toBeNull()
  })
})

describe('privateQuestionNotice', () => {
  it('tells the asker who else reads a private question, or that its channel was archived', () => {
    const asked = conversation({ kind: 'group', privateQuestionOf: 'payments-wiki' })
    expect(privateQuestionNotice(asked, [wiki])).toBe(
      'Only you, Payments wiki and the managers of #payments-wiki are here. Whoever manages #payments-wiki later joins too and reads everything here.',
    )
    expect(privateQuestionNotice(asked, [])).toContain('Only you, #payments-wiki and')
    expect(privateQuestionNotice({ ...asked, privateQuestionOf: null }, [wiki])).toBe(
      strings.channelAgent.privateNoticeArchived,
    )
    expect(privateQuestionNotice({ ...asked, archivedAt: 5 }, [wiki])).toBe(
      strings.channelAgent.privateNoticeArchived,
    )
    expect(privateQuestionNotice(conversation(), [wiki])).toBeNull()
    expect(privateQuestionNotice(undefined, [wiki])).toBeNull()
  })
})

describe('deviceTargetsModel', () => {
  it('offers the agents of the channels the person manages beside their own agent', () => {
    const managed = { ...wiki, joined: true, managing: true, runsAgent: true }
    expect(
      deviceTargetsModel([managed, channel('quiet', { joined: true, managing: true })], everything()),
    ).toEqual({
      label: strings.channelAgent.connectAs,
      choices: [
        { value: '', label: strings.channelAgent.connectAsMe },
        { value: 'payments-wiki', label: 'Payments wiki, the agent of #payments-wiki' },
      ],
    })
    expect(deviceTargetsModel([wiki], everything())).toBeNull()
    expect(deviceTargetsModel([managed], serverInfo())).toBeNull()
  })

  it('offers no agent to an administrator who sees an open channel as managing without being in its group', () => {
    const seenByAdmin = { ...wiki, joined: true, managing: true, runsAgent: false }
    expect(deviceTargetsModel([seenByAdmin], everything())).toBeNull()
  })
})

describe('channelAgentPageModel', () => {
  it('waits for the channels, then shows a manager the channel and anyone else nothing', () => {
    expect(channelAgentPageModel([], false, 'payments-wiki')).toEqual({ kind: 'loading' })
    expect(channelAgentPageModel([], true, 'payments-wiki')).toEqual({
      kind: 'missing',
      text: strings.channelAgent.notYours,
    })
    expect(channelAgentPageModel([wiki], false, 'payments-wiki')).toMatchObject({ kind: 'missing' })
    const managed = { ...wiki, runsAgent: true }
    expect(channelAgentPageModel([managed], true, 'payments-wiki')).toEqual({
      kind: 'channel',
      title: 'The agent of #payments-wiki',
      channel: managed,
    })
  })
})

describe('agentAuthorshipLine', () => {
  const agentMembers = new Map([
    ...members,
    [AGENT, member(AGENT, 'Payments wiki', { kind: 'channel_agent' })],
  ])
  const room = conversation({ id: wiki.conversationId, kind: 'channel' })

  it('says a channel’s agent wrote its note, and who edited it, never as a person’s agent', () => {
    const sent = note('note_a', { authorId: AGENT, origin: 'agent', approvedBy: ANA })
    expect(agentAuthorshipLine(sent, room, [wiki], agentMembers)).toBe(
      'Written by Payments wiki, the agent of #payments-wiki',
    )
    const edited = { ...sent, origin: 'human_edited' as const }
    expect(agentAuthorshipLine(edited, room, [wiki], agentMembers)).toBe(
      'Written by Payments wiki, the agent of #payments-wiki, edited by Ana',
    )
    expect(agentAuthorshipLine(edited, undefined, [], new Map([[AGENT, agentMembers.get(AGENT)!]]))).toBe(
      `Written by Payments wiki, the agent of a channel, edited by ${strings.formerMember}`,
    )
    expect(agentAuthorshipLine(sent, room, [], agentMembers)).toBe(
      'Written by Payments wiki, the agent of a channel',
    )
    const asked = conversation({ kind: 'group', privateQuestionOf: 'payments-wiki' })
    expect(agentAuthorshipLine({ ...edited, approvedBy: null }, asked, [], agentMembers)).toBe(
      'Written by Payments wiki, the agent of #payments-wiki',
    )
  })

  it('leaves a person’s note, and one by someone unknown, to the person’s own wording', () => {
    expect(agentAuthorshipLine(note('note_b', { authorId: BEN }), room, [wiki], agentMembers)).toBeNull()
    expect(agentAuthorshipLine(note('note_c', { authorId: AGENT }), room, [wiki], members)).toBeNull()
  })
})

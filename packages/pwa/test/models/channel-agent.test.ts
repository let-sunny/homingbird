import type { AsRead, ConversationId, MemberId, NoteId } from '@homingbird/protocol'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { heldWordsFor } from '../../src/held-decisions.ts'
import {
  agentAuthorshipLine,
  agentControlsModel,
  agentPanelModel,
  approvalLine,
  channelAgentPageModel,
  decidedAnswerModel,
  deviceTargetsModel,
  privateQuestionNotice,
  reviewBadgeOf,
  reviewCardsModel,
  reviewsInRoomModel,
} from '../../src/models/channel-agent.ts'
import { strings, useLanguage } from '../../src/strings.ts'
import { threadItems } from '../../src/thread.ts'
import {
  ANA,
  BEN,
  CY,
  ROOM,
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
    expect(agentPanelModel('loading', members, 'page', false)).toEqual({ kind: 'loading' })
    expect(agentPanelModel('failed', members, 'page', false)).toEqual({
      kind: 'failed',
      text: strings.channelAgent.loadFailed,
    })
    expect(agentPanelModel(null, members, 'dialog', false)).toMatchObject({
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
      'page',
      true,
    )
    expect(panel).toMatchObject({
      kind: 'agent',
      name: 'Payments wiki',
      retireTitle: strings.channelAgent.retireTitle,
      retire: 'Retire Payments wiki',
      page: null,
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
      'page',
      false,
    )
    expect(empty).toMatchObject({ desksNone: strings.channelAgent.desksNone })
  })

  it('leads from the dialog to the agent’s page, where its answers and figures are', () => {
    const panel = agentPanelModel(
      { agent: member(AGENT, 'Payments wiki'), channel: 'payments-wiki', credentials: [] },
      members,
      'dialog',
      false,
    )
    expect(panel).toMatchObject({
      page: {
        href: '#/channel/payments-wiki/agent',
        label: strings.channelAgent.openPage,
        hint: strings.channelAgent.openPageHint,
      },
    })
  })

  it('points to Run on a server only while the server offers join codes', () => {
    const agent = { agent: member(AGENT, 'Payments wiki'), channel: 'payments-wiki', credentials: [] }
    expect(agentPanelModel(agent, members, 'page', true)).toMatchObject({
      connectHint: strings.channelAgent.connectHintWithJoin({ agent: 'Payments wiki' }),
    })
    expect(agentPanelModel(agent, members, 'page', false)).toMatchObject({
      connectHint: strings.channelAgent.connectHint({ agent: 'Payments wiki' }),
    })
    expect(strings.channelAgent.connectHint({ agent: 'Payments wiki' })).not.toContain('Run on a server')
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
      new Map(),
      'note_two',
    )
    expect(model.none).toBeNull()
    expect(model.cards.map((card) => card.focused)).toEqual([false, true])
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

  it('says why the manager sees each answer, that a send goes to the room or a private asker, and keeps a discard’s reason from the asker', () => {
    const [asked, privately] = reviewCardsModel(
      [review(), review({ privately: true, question: null })],
      'payments-wiki',
      new Map(),
      members,
      new Map(),
      null,
    ).cards
    expect(asked).toMatchObject({
      why: strings.channelAgent.whyYouReview({ channel: '#payments-wiki' }),
      send: strings.channelAgent.send,
      edit: strings.channelAgent.edit,
      held: heldWordsFor('#payments-wiki'),
      editText: review().note.body,
      keptEdit: null,
      discarding: {
        hint: strings.channelAgent.discardReasonHint({ channel: '#payments-wiki', name: 'Cy' }),
        confirm: strings.channelAgent.discardConfirm,
      },
    })
    expect(privately).toMatchObject({
      held: heldWordsFor('#payments-wiki'),
      discarding: { hint: strings.channelAgent.discardReasonHintPrivately({ channel: '#payments-wiki' }) },
    })
    const unknownAsker = reviewCardsModel(
      [review({ question: note('note_q', { authorId: 'mem_gone00000000' as MemberId }) })],
      'payments-wiki',
      new Map(),
      members,
      new Map(),
      null,
    ).cards[0]!
    expect(unknownAsker.held.send.pending).toBe(strings.heldSending({ names: '#payments-wiki' }))
    const askedPrivately = reviewCardsModel(
      [review({ privately: true })],
      'payments-wiki',
      new Map(),
      members,
      new Map([[review().note.id, 'my words']]),
      null,
    ).cards[0]!
    expect(askedPrivately).toMatchObject({
      held: heldWordsFor('Cy'),
      editText: 'my words',
      keptEdit: strings.draftEditKept,
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
      new Map(),
      null,
    )
    expect(changed.cards[0]!.readAgain).toEqual({
      notice: strings.draftChangedSinceRead,
      confirm: strings.draftReadAgain,
    })
    expect(changed.cards[0]!.question!.from).toBe(`Question from ${strings.formerMember}`)
    expect(reviewCardsModel([], 'payments-wiki', new Map(), members, new Map(), null).none).toBe(
      strings.channelAgent.reviewsNone,
    )
  })

  it('counts a channel’s answers waiting and leads into its room at the first question waiting', () => {
    const OPS_ROOM = 'conv_ops00000000' as ConversationId
    const reviews = [
      review({ note: draft('note_later', { authorId: AGENT, createdAt: 9 }) }),
      review({ note: draft('note_private', { conversationId: OPS_ROOM, createdAt: 1 }), privately: true }),
      review({ note: draft('note_first', { authorId: AGENT, createdAt: 5 }) }),
      review({ channel: 'ops', privately: true, note: draft('note_ops', { conversationId: OPS_ROOM }) }),
    ]
    expect(reviewBadgeOf(reviews, 'payments-wiki')).toEqual({
      text: 'Review 3',
      label: '3 answers wait for your review',
      href: `#/c/${ROOM}?review=note_first`,
    })
    expect(reviewBadgeOf(reviews, 'ops')).toEqual({
      text: 'Review 1',
      label: '1 answer waits for your review',
      href: `#/c/${OPS_ROOM}?review=note_ops`,
    })
    expect(reviewBadgeOf(reviews, 'billing')).toBeNull()
    useLanguage('ko')
    expect(reviewBadgeOf([review()], 'payments-wiki')).toMatchObject({
      text: '검토 1',
      label: '답 1개가 검토를 기다려요',
    })
  })
})

describe('reviewsInRoomModel', () => {
  const inRoom = (
    reviews: ReadonlyArray<AsRead.Review>,
    notes: ReadonlyArray<AsRead.Note>,
    viewerId: MemberId = ANA,
    focus: string | null = null,
  ) =>
    reviewsInRoomModel(
      threadItems(notes),
      reviews,
      { conversationId: ROOM, viewerId },
      new Map(),
      members,
      new Map(),
      focus,
    )
  const question = note('note_question000', { authorId: CY, body: 'Where is the runbook?', sentAt: 2 })
  const notes = [note('note_before', { sentAt: 1 }), question, note('note_after', { sentAt: 3 })]

  it('places a waiting answer right under the question it answers, without quoting it again', () => {
    const items = inRoom([review()], notes, ANA, 'note_answer00000')
    expect(items.map((item) => item.key)).toEqual([
      'note_before',
      'note_question000',
      'review:note_answer00000',
      'note_after',
    ])
    const placed = items[2]!
    expect(placed.type === 'review' && placed.card).toMatchObject({
      focused: true,
      question: null,
      heading: strings.channelAgent.waitsInRoom({ agent: 'Payments wiki' }),
      basis: { lines: ['wiki/refunds.md'] },
      send: strings.channelAgent.send,
      discard: strings.channelAgent.discard,
    })
  })

  it('keeps an answer whose question is not loaded at the end, quoting its question', () => {
    const items = inRoom([review()], [note('note_before')])
    expect(items.map((item) => item.key)).toEqual(['note_before', 'review:note_answer00000'])
    const last = items[1]!
    expect(last.type === 'review' && last.card.question).toEqual({
      from: 'Question from Cy',
      body: 'Where is the runbook?',
    })
  })

  it('places an answer by the question it carries when it names no note it replies to', () => {
    const unlinked = review({ note: draft('note_answer00000', { authorId: AGENT, inReplyTo: null }) })
    expect(inRoom([unlinked], notes).map((item) => item.key)).toEqual([
      'note_before',
      'note_question000',
      'review:note_answer00000',
      'note_after',
    ])
    const orphan = review({
      note: draft('note_orphan', { authorId: AGENT, inReplyTo: null }),
      question: null,
    })
    expect(inRoom([orphan], notes).map((item) => item.key)).toEqual([
      ...notes.map((one) => one.id),
      'review:note_orphan',
    ])
  })

  it('shows nothing new to the person who asked, or for answers waiting in another room', () => {
    expect(inRoom([review()], notes, CY).map((item) => item.key)).toEqual(notes.map((one) => one.id))
    const elsewhere = review({ note: draft('note_away', { conversationId: 'conv_away0000000' as never }) })
    expect(inRoom([elsewhere], notes).every((item) => item.type === 'note')).toBe(true)
  })

  it('shows nothing to a person who reviews nothing, whatever the room holds', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 50 }), { maxLength: 8 }), (times) => {
        const room = times.map((sentAt, index) => note(`note_${index}`, { sentAt }))
        const items = inRoom([], room)
        expect(items.map((item) => item.key)).toEqual(threadItems(room).map((item) => item.key))
      }),
    )
  })
})

describe('decidedAnswerModel', () => {
  const members = new Map([[BEN, member(BEN, 'Ben')]])

  it('names the manager who already sent the answer, or the person themself', () => {
    const sent = (approvedBy: MemberId) => note('note_answer00000', { authorId: AGENT, approvedBy })
    expect(decidedAnswerModel(sent(BEN), ANA, members)).toBe('Ben already sent this answer.')
    expect(decidedAnswerModel(sent(ANA), ANA, members)).toBe(strings.channelAgent.decided.sentByYou)
    expect(decidedAnswerModel(sent(CY), ANA, members)).toBe(
      strings.channelAgent.decided.sentBy({ name: strings.formerMember }),
    )
    useLanguage('ko')
    expect(decidedAnswerModel(sent(BEN), ANA, members)).toBe('Ben 님이 이미 이 답을 보냈어요.')
  })

  it('says only that the answer no longer waits when it cannot be read or was not sent by a manager', () => {
    expect(decidedAnswerModel(null, ANA, members)).toBe(strings.channelAgent.decided.gone)
    expect(decidedAnswerModel(note('note_answer00000', { authorId: AGENT }), ANA, members)).toBe(
      strings.channelAgent.decided.gone,
    )
    expect(
      decidedAnswerModel(draft('note_answer00000', { authorId: AGENT, approvedBy: BEN }), null, members),
    ).toBe(strings.channelAgent.decided.gone)
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
      agentState: null,
    })
    expect(channelAgentPageModel([{ ...managed, agent: null }], true, 'payments-wiki')).toMatchObject({
      kind: 'channel',
      agentState: null,
    })
    const awake = {
      ...managed,
      agent: { id: AGENT, name: 'Payments wiki', presence: { humanOnline: false, agentOnline: true } },
    }
    expect(channelAgentPageModel([awake], true, 'payments-wiki')).toMatchObject({
      agentState: { state: 'on', label: strings.channelAgentState.awake({ agent: 'Payments wiki' }) },
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

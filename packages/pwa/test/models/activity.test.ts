import type { AsRead, ConversationId, DebateId, MemberId, NoteId } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { heldWordsFor } from '../../src/held-decisions.ts'
import { type ActivityInput, RESULT_LISTED_MS, activityModel } from '../../src/models/activity.ts'
import { formats, strings } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CHANNEL_ROOM,
  CY,
  ROOM,
  channel,
  conversation,
  draft,
  entry,
  everything,
  me,
  member,
  note,
  serverInfo,
  suggestion,
  summary,
} from '../support/fixtures.ts'

const AGENT = 'mem_agent0000000' as MemberId
const OTHER_ROOM = 'conv_other0000000' as ConversationId
const NOW = 1_000_000

const input = (fields: Partial<ActivityInput> = {}): ActivityInput => ({
  me: me(),
  threads: new Map(),
  conversations: [conversation()],
  channels: [],
  members: new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben')],
    [CY, member(CY, 'Cy')],
  ]),
  directory: [],
  draftsRead: new Map(),
  draftEdits: new Map(),
  held: [],
  draftRequests: [],
  releases: new Map(),
  reviews: [],
  reviewsRead: new Map(),
  debates: [],
  suggestions: [],
  taught: null,
  agentReport: null,
  serverInfo: everything(),
  now: NOW,
  ...fields,
})

const thread = (...notes: AsRead.Note[]) => ({ notes, hasMore: false })

const review = (fields: Partial<AsRead.Review> = {}): AsRead.Review => ({
  note: draft('note_answer00000', {
    authorId: AGENT,
    conversationId: CHANNEL_ROOM,
    inReplyTo: 'note_question000' as NoteId,
    updatedAt: 50,
  }),
  question: note('note_question000', { authorId: CY, conversationId: CHANNEL_ROOM, body: 'Where is it?' }),
  channel: 'payments',
  agent: member(AGENT, 'Payments helper', { kind: 'channel_agent' }),
  privately: false,
  ...fields,
})

const kinds = (model: ReturnType<typeof activityModel>) => model.groups.map((group) => group.kind)
const itemsOf = (model: ReturnType<typeof activityModel>, kind: string) =>
  model.groups.find((group) => group.kind === kind)?.items ?? []

describe('activityModel', () => {
  it('says in words that nothing waits, and the bell says so too', () => {
    expect(activityModel(input())).toEqual({
      title: strings.activity.title,
      count: 0,
      label: strings.activity.bellNone,
      agent: null,
      empty: strings.activity.empty,
      groups: [],
    })
  })

  it('lists the person’s own drafts with the card the conversation shows, linked to the first draft', () => {
    const question = note('note_q', { authorId: BEN, body: 'Lunch?' })
    const first = draft('note_d1', { inReplyTo: question.id, updatedAt: 5 })
    const second = draft('note_d2', { inReplyTo: question.id, updatedAt: 7 })
    const model = activityModel(input({ threads: new Map([[ROOM, thread(question, first, second)]]) }))
    expect(model.count).toBe(2)
    expect(model.label).toBe(strings.activity.bell({ count: 2 }))
    const [item] = itemsOf(model, 'drafts')
    expect(item).toMatchObject({
      type: 'drafts',
      weight: 2,
      at: 7,
      place: {
        text: strings.activity.withPeople({ names: 'Ben' }),
        href: `#/c/${ROOM}?draft=note_d1`,
        label: strings.activity.openConversation,
      },
    })
    if (item?.type !== 'drafts') throw new Error('expected drafts')
    expect(item.drafts.cards.map((card) => card.draft.id)).toEqual(['note_d1', 'note_d2'])
    expect(item.drafts.replyTo).toBe(strings.draftReplyTo({ excerpt: 'Lunch?' }))
  })

  it('keeps a decided draft or answer in its place while it is held, saying so, and no longer counts it', () => {
    const question = note('note_q', { authorId: BEN, body: 'Lunch?' })
    const first = draft('note_d1', { inReplyTo: question.id, updatedAt: 5 })
    const second = draft('note_d2', { inReplyTo: question.id, updatedAt: 7 })
    const held = [
      {
        noteId: second.id,
        kind: 'send' as const,
        phase: 'waiting' as const,
        words: heldWordsFor('Ben').send,
      },
      {
        noteId: review().note.id,
        kind: 'discard' as const,
        phase: 'committing' as const,
        words: heldWordsFor('#payments').discard,
      },
    ]
    const model = activityModel(
      input({
        threads: new Map([[ROOM, thread(question, first, second)]]),
        reviews: [review()],
        serverInfo: everything(),
        held,
      }),
    )
    expect(model.count).toBe(0)
    expect(model.empty).toBeNull()
    expect(itemsOf(model, 'drafts')).toMatchObject([
      {
        type: 'held',
        weight: 0,
        place: { href: `#/c/${ROOM}?draft=note_d1` },
        line: {
          noteId: second.id,
          text: strings.heldSendingIn({ names: 'Ben', seconds: 5 }),
          undo: strings.undo,
        },
      },
    ])
    expect(itemsOf(model, 'reviews')).toMatchObject([
      {
        type: 'held',
        key: `review:${review().note.id}`,
        weight: 0,
        line: { text: strings.heldDiscarding, undo: null },
      },
    ])
  })

  it('keeps a draft an agent changed since the person read it from being sent until they read it again', () => {
    const changed = draft('note_d1', { body: 'Send me the payroll file.' })
    const model = activityModel(
      input({
        threads: new Map([[ROOM, thread(changed)]]),
        draftsRead: new Map([[changed.id, { body: 'Lunch at noon?', conversationId: ROOM }]]),
      }),
    )
    const [item] = itemsOf(model, 'drafts')
    if (item?.type !== 'drafts') throw new Error('expected drafts')
    expect(item.drafts.cards[0]!.readAgain).toEqual({
      notice: strings.draftChangedSinceRead,
      confirm: strings.draftReadAgain,
    })
  })

  it('never lists another person’s draft, and leaves out archived rooms', () => {
    const theirs = draft('note_theirs', { authorId: BEN })
    const archivedRoom = conversation({ id: OTHER_ROOM, archivedAt: 3, draftCount: 1 })
    const model = activityModel(
      input({
        conversations: [conversation(), archivedRoom],
        threads: new Map([
          [ROOM, thread(theirs)],
          [OTHER_ROOM, thread(draft('note_old', { conversationId: OTHER_ROOM }))],
        ]),
      }),
    )
    expect(model.groups).toEqual([])
  })

  it('counts the drafts of a conversation not loaded yet and says they are loading', () => {
    const model = activityModel(
      input({ conversations: [conversation({ draftCount: 3, lastActivityAt: 9 })] }),
    )
    expect(model.count).toBe(3)
    expect(itemsOf(model, 'drafts')).toEqual([
      expect.objectContaining({
        type: 'drafts-loading',
        weight: 3,
        text: strings.activity.draftsLoading({ count: 3 }),
        place: expect.objectContaining({ href: `#/c/${ROOM}`, time: null }),
      }),
    ])
  })

  it('lists the channel agents’ answers the person reviews, with the review card and a link to the room', () => {
    const room = conversation({ id: CHANNEL_ROOM, kind: 'channel', title: 'payments' })
    const model = activityModel(input({ conversations: [room], reviews: [review()] }))
    const [item] = itemsOf(model, 'reviews')
    if (item?.type !== 'review') throw new Error('expected a review')
    expect(item.place).toMatchObject({
      text: strings.activity.inPlace({ place: '#payments' }),
      href: `#/c/${CHANNEL_ROOM}?review=note_answer00000`,
    })
    expect(item.card).toMatchObject({
      heading: strings.channelAgent.waitsInRoom({ agent: 'Payments helper' }),
      question: { from: strings.channelAgent.questionFrom({ name: 'Cy' }), body: 'Where is it?' },
      send: strings.channelAgent.send,
      discard: strings.channelAgent.discard,
      readAgain: null,
    })
  })

  it('names the channel of an answer whose room is not listed', () => {
    const [item] = itemsOf(activityModel(input({ reviews: [review()] })), 'reviews')
    expect(item?.place.text).toBe(strings.activity.inPlace({ place: '#payments' }))
  })

  it('never shows an answer to the person who asked its question, nor one they wrote', () => {
    const model = activityModel(
      input({
        reviews: [
          review({ question: note('note_q', { authorId: ANA }) }),
          review({ note: draft('note_mine', { authorId: ANA }) }),
        ],
      }),
    )
    expect(model.groups).toEqual([])
  })

  it('leaves out answers to review while the organization has channel agents off', () => {
    expect(activityModel(input({ reviews: [review()], serverInfo: serverInfo() })).groups).toEqual([])
  })

  it('lists a note the person’s agent skipped, with its reason, until they answer it', () => {
    const asked = note('note_asked', { authorId: BEN, body: 'Does the window clash?', sentAt: 40 })
    const release = { reason: 'I cannot see the calendar.', agentName: 'Desk' }
    const shown = activityModel(
      input({ threads: new Map([[ROOM, thread(asked)]]), releases: new Map([[asked.id, release]]) }),
    )
    expect(itemsOf(shown, 'skipped')).toEqual([
      {
        type: 'skipped',
        key: 'skipped:note_asked',
        at: 40,
        weight: 1,
        place: expect.objectContaining({ href: `#/c/${ROOM}` }),
        from: strings.activity.skippedFrom({ name: 'Ben' }),
        fromId: BEN,
        body: 'Does the window clash?',
        reason: strings.agentReleased({ reason: 'I cannot see the calendar.' }),
        reply: strings.activity.replyYourself,
        replyTo: { conversationId: ROOM, noteId: asked.id },
        teach: { label: strings.teach.add, seed: { topic: 'Does the window clash', place: null } },
      },
    ])
    const withoutTeaching = activityModel(
      input({
        threads: new Map([[ROOM, thread(asked)]]),
        releases: new Map([[asked.id, release]]),
        serverInfo: serverInfo(),
      }),
    )
    expect(itemsOf(withoutTeaching, 'skipped')).toEqual([expect.objectContaining({ teach: null })])
    const inChannel = activityModel(
      input({
        threads: new Map([[ROOM, thread(asked)]]),
        releases: new Map([[asked.id, release]]),
        channels: [channel('deploys', { conversationId: ROOM })],
      }),
    )
    expect(itemsOf(inChannel, 'skipped')).toEqual([
      expect.objectContaining({
        teach: expect.objectContaining({ seed: expect.objectContaining({ place: 'deploys' }) }),
      }),
    ])
    const answered = note('note_reply', { authorId: ANA, inReplyTo: asked.id })
    const replied = activityModel(
      input({
        threads: new Map([[ROOM, thread(asked, answered)]]),
        releases: new Map([[asked.id, release]]),
      }),
    )
    expect(kinds(replied)).toEqual([])
    const laterWithoutStamp = note('note_later', { authorId: ANA, sentAt: null, createdAt: 50 })
    const spokeLater = activityModel(
      input({
        threads: new Map([[ROOM, thread(asked, laterWithoutStamp)]]),
        releases: new Map([[asked.id, release]]),
      }),
    )
    expect(kinds(spokeLater)).toEqual([])
  })

  it('moves a skipped note to the drafts once the person’s agent drafts a reply after all', () => {
    const asked = note('note_asked', { authorId: BEN })
    const model = activityModel(
      input({
        threads: new Map([[ROOM, thread(asked, draft('note_d', { inReplyTo: asked.id }))]]),
        releases: new Map([[asked.id, { reason: null, agentName: null }]]),
      }),
    )
    expect(kinds(model)).toEqual(['drafts'])
  })

  it('says a skip without a reason plainly, and skips what it cannot place', () => {
    const asked = note('note_asked', { authorId: 'mem_gone00000000' as MemberId, sentAt: null, createdAt: 4 })
    const model = activityModel(
      input({
        threads: new Map([[ROOM, thread(asked, note('note_own', { authorId: ANA }))]]),
        releases: new Map([
          [asked.id, { reason: null, agentName: null }],
          ['note_own' as NoteId, { reason: null, agentName: null }],
          ['note_unknown' as NoteId, { reason: 'x', agentName: null }],
        ]),
      }),
    )
    expect(itemsOf(model, 'skipped')).toEqual([
      expect.objectContaining({
        at: 4,
        reason: strings.agentReleasedWithoutReason,
        from: strings.activity.skippedFrom({ name: strings.formerMember }),
      }),
    ])
  })

  it('leaves out a skipped note in a room no longer listed or archived', () => {
    const asked = note('note_asked', { authorId: BEN })
    const release = new Map([[asked.id, { reason: null, agentName: null }]])
    const threads = new Map([[ROOM, thread(asked)]])
    expect(activityModel(input({ threads, releases: release, conversations: [] })).groups).toEqual([])
    expect(
      activityModel(input({ threads, releases: release, conversations: [conversation({ archivedAt: 2 })] }))
        .groups,
    ).toEqual([])
  })

  it('tells apart that the person’s running desk cannot answer, never counting it, and leads to Connection', () => {
    const presence = {
      humanOnline: true,
      agentOnline: true,
      agentUnavailable: { until: null, kind: 'signed_out' },
    }
    const model = activityModel(input({ directory: [entry(ANA, 'Ana', { presence } as never)] }))
    expect(model.agent).toEqual({
      heading: strings.activity.unavailableTitle,
      lines: [strings.deskUnavailableReason.signed_out],
      href: '#/agent/connection',
      label: strings.activity.openConnection,
    })
    expect(model.count).toBe(0)
    expect(model.groups).toEqual([])
    expect(model.empty).toBeNull()
    expect(model.label).toBe(strings.activity.bellNoneAgentUnavailable)
    const withDraft = activityModel(
      input({
        directory: [entry(ANA, 'Ana', { presence } as never)],
        threads: new Map([[ROOM, thread(draft('note_d1'))]]),
      }),
    )
    expect(withDraft.count).toBe(1)
    expect(withDraft.label).toBe(strings.activity.bellAgentUnavailable({ count: 1 }))
    const asleep = { humanOnline: true, agentOnline: false, agentUnavailable: { until: null } }
    expect(activityModel(input({ directory: [entry(ANA, 'Ana', { presence: asleep })] })).agent).toBeNull()
  })

  it('clears a skipped note once the person writes below it, quoting it or not, but not before', () => {
    const asked = note('note_asked', { authorId: BEN, sentAt: 40 })
    const releases = new Map([[asked.id, { reason: null, agentName: null }]])
    const withNotes = (...others: AsRead.Note[]) =>
      kinds(activityModel(input({ threads: new Map([[ROOM, thread(asked, ...others)]]), releases })))
    expect(withNotes(note('note_later', { authorId: ANA, sentAt: 41 }))).toEqual([])
    expect(withNotes(note('note_earlier', { authorId: ANA, sentAt: 39 }))).toEqual(['skipped'])
    expect(withNotes(note('note_theirs', { authorId: BEN, sentAt: 41 }))).toEqual(['skipped'])
    expect(
      withNotes(draft('note_gone', { status: 'discarded', inReplyTo: asked.id, createdAt: 50 })),
    ).toEqual(['skipped'])
  })

  it('counts exactly the things its groups list', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), fc.boolean(), (drafts, skipped) => {
        const asked = note('note_asked', { authorId: BEN, sentAt: 1 })
        const own = Array.from({ length: drafts }, (_, index) =>
          draft(`note_d${index}`, { inReplyTo: null, updatedAt: 2 + index }),
        )
        const model = activityModel(
          input({
            threads: new Map([[ROOM, thread(asked, ...own)]]),
            releases: skipped ? new Map([[asked.id, { reason: null, agentName: null }]]) : new Map(),
          }),
        )
        const listed = model.groups
          .flatMap((group) => group.items)
          .reduce((sum, item) => sum + (item.type === 'drafts' ? item.drafts.cards.length : 1), 0)
        expect(model.count).toBe(listed)
      }),
    )
  })

  it('lists a room that asks the person’s agent and a closed room whose result they may post, each opening on its tab', () => {
    const asks = summary({
      id: 'debate_asks0000000' as DebateId,
      createdAt: 30,
      createdBy: BEN,
      participantIds: [BEN],
    })
    const result = summary({
      id: 'debate_result00000' as DebateId,
      status: 'closed',
      resultDrafted: true,
      participantIds: [ANA, BEN],
      deadlineAt: NOW - 1000,
    })
    const model = activityModel(input({ debates: [asks, result] }))
    expect(itemsOf(model, 'debates').map((item) => [item.key, item.type === 'debate' && item.text])).toEqual([
      ['debate:debate_result00000', strings.activity.debateResult],
      [
        'debate:debate_asks0000000',
        strings.activity.debateAsks({ person: 'Ben', time: formats.full.format(new Date(asks.deadlineAt)) }),
      ],
    ])
    expect(itemsOf(model, 'debates')[0]!.place).toMatchObject({
      text: result.question,
      href: '#/debate/debate_result00000/result',
      label: strings.activity.openRoom,
    })
    expect(itemsOf(model, 'debates')[1]!.place.href).toBe('#/debate/debate_asks0000000/turns')
  })

  it('lists a short debate the agent suggested, newest first, counted once and opening where its note is', () => {
    const model = activityModel(
      input({
        suggestions: [
          suggestion({ createdAt: 3 }),
          suggestion({ id: 'sugg_111111111111' as never, createdAt: 9, draftId: 'note_d1' as NoteId }),
        ],
      }),
    )
    expect(kinds(model)).toEqual(['suggestions'])
    expect(model.count).toBe(2)
    const items = itemsOf(model, 'suggestions')
    expect(items.map((item) => item.key)).toEqual([
      'suggestion:sugg_111111111111',
      'suggestion:sugg_000000000000',
    ])
    expect(items[0]!.place).toMatchObject({
      conversationId: ROOM,
      href: '#/c/conv_room00000000?draft=note_d1',
    })
    expect(items[0]!.type === 'suggestion' && items[0]!.card.heading).toContain('Desk')
  })

  it('names a suggestion’s place by its conversation, or by its note when the conversation is not known', () => {
    const known = activityModel(input({ suggestions: [suggestion()] }))
    expect(itemsOf(known, 'suggestions')[0]!.place.text).toBe(strings.activity.withPeople({ names: 'Ben' }))
    const unknown = activityModel(input({ conversations: [], suggestions: [suggestion()] }))
    expect(itemsOf(unknown, 'suggestions')[0]!.place.text).toBe(strings.debateSuggestion.forNote)
  })

  it('leaves suggestions out while short debates are off', () => {
    const off = serverInfo({ debateRooms: true })
    expect(activityModel(input({ suggestions: [suggestion()], serverInfo: off })).groups).toEqual([])
  })

  it('says who asks the agent to help answer a question, until when, for a room an agent’s suggestion opened', () => {
    const asks = summary({
      createdBy: BEN,
      participantIds: [BEN],
      fromSuggestion: true,
      deadlineAt: NOW + 60_000,
    })
    const [item] = itemsOf(activityModel(input({ debates: [asks] })), 'debates')
    expect(item!.type === 'debate' && item!.text).toBe(
      strings.activity.debateAsksSuggested({
        person: 'Ben',
        time: formats.full.format(new Date(NOW + 60_000)),
      }),
    )
    const former = summary({ createdBy: 'mem_gone00000000' as MemberId, participantIds: [BEN] })
    const [unknown] = itemsOf(activityModel(input({ debates: [former] })), 'debates')
    expect(unknown!.type === 'debate' && unknown!.text).toContain(strings.formerMember)
  })

  it('lists a suggested room’s result only to the person whose agent suggested it, who answers from it', () => {
    const closed = {
      status: 'closed',
      resultDrafted: true,
      participantIds: [ANA, BEN],
      deadlineAt: NOW,
    } as const
    const theirs = summary({ ...closed, createdBy: BEN, fromSuggestion: true })
    expect(activityModel(input({ debates: [theirs] })).groups).toEqual([])
    const mine = summary({ ...closed, createdBy: ANA, fromSuggestion: true })
    expect(itemsOf(activityModel(input({ debates: [mine] })), 'debates')).toHaveLength(1)
  })

  it('leaves out rooms that need nothing of the person', () => {
    const rooms = [
      summary({ participantIds: [ANA, BEN] }),
      summary({ joined: false }),
      summary({ status: 'concluding', participantIds: [BEN] }),
      summary({ status: 'closed', resultDrafted: true, participantIds: [BEN] }),
      summary({ status: 'closed', resultDrafted: false, participantIds: [ANA] }),
      summary({
        status: 'closed',
        resultDrafted: true,
        participantIds: [ANA],
        deadlineAt: NOW - RESULT_LISTED_MS - 1,
      }),
    ]
    expect(activityModel(input({ debates: rooms })).groups).toEqual([])
  })

  it('leaves out a closed room once the person posted its result, and every room while debate rooms are off', () => {
    const room = summary({ status: 'closed', resultDrafted: true, participantIds: [ANA], deadlineAt: NOW })
    const posted = note('note_posted', {
      authorId: ANA,
      fromDebate: { debateId: room.id, question: room.question, agents: [] },
    })
    expect(
      activityModel(input({ debates: [room], threads: new Map([[ROOM, thread(posted)]]) })).groups,
    ).toEqual([])
    expect(activityModel(input({ debates: [room], serverInfo: serverInfo() })).groups).toEqual([])
  })

  it('groups the kinds in a fixed order, the newest first in each', () => {
    const older = draft('note_old', { updatedAt: 2 })
    const newer = draft('note_new', { conversationId: OTHER_ROOM, updatedAt: 8 })
    const model = activityModel(
      input({
        conversations: [conversation(), conversation({ id: OTHER_ROOM, participantIds: [ANA, CY] })],
        threads: new Map([
          [ROOM, thread(older)],
          [OTHER_ROOM, thread(newer)],
        ]),
        reviews: [review()],
        suggestions: [suggestion()],
        debates: [summary({ participantIds: [BEN] })],
      }),
    )
    expect(kinds(model)).toEqual(['drafts', 'reviews', 'suggestions', 'debates'])
    expect(itemsOf(model, 'drafts').map((item) => item.at)).toEqual([8, 2])
    expect(model.groups.map((group) => group.title)).toEqual([
      strings.activity.groups.drafts,
      strings.activity.groups.reviews,
      strings.activity.groups.suggestions,
      strings.activity.groups.debates,
    ])
  })

  it('shows only the person’s own drafts and never an answer to their own question, whoever wrote what', () => {
    const people = fc.constantFrom(ANA, BEN, CY, AGENT)
    fc.assert(
      fc.property(fc.array(fc.record({ author: people, asker: people }), { maxLength: 6 }), (cases) => {
        const drafts = cases.map((one, index) => draft(`note_d${index}`, { authorId: one.author }))
        const reviews = cases.map((one, index) =>
          review({
            note: draft(`note_r${index}`, { authorId: one.author, conversationId: CHANNEL_ROOM }),
            question: note(`note_q${index}`, { authorId: one.asker }),
          }),
        )
        const model = activityModel(input({ threads: new Map([[ROOM, thread(...drafts)]]), reviews }))
        for (const item of itemsOf(model, 'drafts'))
          if (item.type === 'drafts')
            for (const card of item.drafts.cards) expect(card.draft.authorId).toBe(ANA)
        for (const item of itemsOf(model, 'reviews'))
          if (item.type === 'review') {
            expect(item.card.review.question?.authorId).not.toBe(ANA)
            expect(item.card.review.note.authorId).not.toBe(ANA)
          }
      }),
    )
  })
})

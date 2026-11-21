import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { noteItemModel } from '../../src/models/note-item.ts'
import { timeShown } from '../../src/models/time.ts'
import { formats, strings } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CY,
  ROOM,
  channel,
  conversation,
  draft,
  entry,
  member,
  note,
  serverInfo,
} from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

const item = (shown: AsRead.Note, fields: { leadsRun?: boolean; next?: AsRead.Note | null } = {}) => ({
  type: 'note' as const,
  key: shown.id,
  note: shown,
  leadsRun: fields.leadsRun ?? true,
  next: fields.next ?? null,
})

const receipt = (memberId: typeof ANA, fields: Partial<AsRead.Receipt> = {}): AsRead.Receipt => ({
  memberId,
  state: 'delivered',
  deliveredAt: 1,
  readAt: null,
  draftingAt: null,
  repliedAt: null,
  ...fields,
})

describe('noteItemModel', () => {
  it('shows beside a channel agent’s answer where it answered and who approved it', () => {
    const answer = note('n1', { authorId: CY, approvedBy: ANA })
    const room = conversation({ kind: 'group', privateQuestionOf: 'wiki' })
    const input = threadInput({ conversations: [room], thread: { notes: [answer], hasMore: false } })
    expect(noteItemModel(input, item(answer)).approval).toBe('#wiki · approved by Ana')
    expect(noteItemModel(input, item(note('n2'))).approval).toBeNull()
  })

  it('says a channel’s agent wrote its answer, as the agent of its channel', () => {
    const answer = note('n1', { authorId: CY, origin: 'agent', agentName: 'Desk', approvedBy: ANA })
    const room = conversation({ kind: 'group', privateQuestionOf: 'wiki' })
    const members = new Map([
      [ANA, member(ANA, 'Ana')],
      [CY, member(CY, 'Wiki', { kind: 'channel_agent' })],
    ])
    const input = threadInput({ conversations: [room], members, thread: { notes: [answer], hasMore: false } })
    expect(noteItemModel(input, item(answer)).author?.line).toBe('Written by Wiki, the agent of #wiki')
  })

  it('shows a colleague’s note leading a run with its author, time, and ways to answer it', () => {
    const theirs = note('n1', { sentAt: 5, receipts: [receipt(ANA)] })
    const model = noteItemModel(threadInput({ thread: { notes: [theirs], hasMore: false } }), item(theirs))
    const sent = formats.full.format(new Date(5))
    expect(model).toMatchObject({
      noteId: 'n1',
      className: 'note is-theirs leads-run is-person',
      unread: true,
      spokenAuthorship: null,
      spokenSent: strings.authorship.sent({ time: sent }),
      authorName: null,
      bubbleTitle: null,
      quote: null,
      body: 'body of n1',
      basis: null,
      answeredBy: null,
      release: null,
      waits: null,
      meta: { time: timeShown(5, 10), mark: null },
      reply: strings.reply,
      menu: {
        id: 'note-menu-n1',
        label: strings.noteMore,
        items: [
          { kind: 'reply', label: strings.reply, reason: null },
          { kind: 'ask-agent', label: strings.askAgentToReply, reason: null },
          { kind: 'copy', label: strings.copyNote, reason: null },
          { kind: 'copy-link', label: strings.copyNoteLink, reason: null },
        ],
      },
    })
    expect(model.author).toMatchObject({
      id: 'author-n1',
      buttonClass: 'author-button is-person',
      buttonLabel: strings.authorship.who({ authorship: strings.authorship.person({ name: 'Ben' }) }),
      agentMark: false,
      line: strings.authorship.person({ name: 'Ben' }),
      debate: null,
      details: [],
      sent: strings.authorship.sent({ time: sent }),
    })
  })

  it('describes what an agent wrote, as far as the organization shows it', () => {
    const byAgent = note('n1', {
      origin: 'agent',
      agentName: 'Laptop',
      agentModel: 'Model X',
      agentClient: 'Desk',
    })
    expect(noteItemModel(threadInput(), item(byAgent)).author!.details.map((detail) => detail.text)).toEqual([
      strings.authorship.model({ model: 'Model X' }),
      strings.authorship.client({ client: 'Desk' }),
      strings.authorship.connection({ name: 'Laptop' }),
      strings.authorship.reported,
    ])
    const unstated = note('n2', { origin: 'human_edited' })
    const author = noteItemModel(threadInput(), item(unstated)).author!
    expect(author.details.map((detail) => detail.text)).toEqual([
      strings.authorship.modelNotStated,
      strings.authorship.clientUnknown,
      strings.authorship.reported,
    ])
    expect(author.line).toBe(strings.authorship.edited({ name: 'Ben' }))
    expect(author.agentMark).toBe(true)
    const hidden = noteItemModel(threadInput({ serverInfo: serverInfo() }), item(byAgent)).author!
    expect(hidden.details).toEqual([])
    expect(hidden.sent).toBeNull()
  })

  it('names the room and its agents for a debate result', () => {
    const fromDebate = note('n1', {
      origin: 'agent',
      fromDebate: { debateId: 'd' as never, question: 'Ship?', agents: [{ agent: 'Desk', person: 'Ben' }] },
    })
    const author = noteItemModel(threadInput(), item(fromDebate)).author!
    expect(author.debate).toBe(
      strings.authorship.fromDebate({
        question: 'Ship?',
        agents: strings.debates.agentOf({ agent: 'Desk', person: 'Ben' }),
      }),
    )
    expect(author.details).toEqual([])
  })

  it('reads a posted debate result for its conclusion and next steps, links its room, and never waits for an answer', () => {
    const fromDebate = { debateId: 'deb_room00000000' as never, question: 'Ship?', agents: [] }
    const body = [
      'From the debate room: Ship?',
      'Result: conclusion',
      'Ship Friday.',
      'Reasons\n\n- Tests pass.',
      'Next steps\n\n- Tag it (for Ben; proposed by Ana’s agent)',
      'Contributions\n\n- Ana’s agent: Checked.',
    ].join('\n\n')
    const room = conversation({ kind: 'channel', participantIds: [ANA, BEN] })
    const posted = note('r', { authorId: ANA, origin: 'agent', body, fromDebate })
    const model = noteItemModel(
      threadInput({ conversations: [room], thread: { notes: [posted], hasMore: false } }),
      item(posted),
    )
    expect(model.debateResult).toEqual({
      parts: {
        heading: strings.debateNote.agreed,
        summary: 'Ship Friday.',
        nextStepsHeading: strings.debateNote.nextSteps,
        nextSteps: ['Tag it (for Ben; proposed by Ana’s agent)'],
      },
      whole: strings.debateNote.whole,
      room: { href: '#/debate/deb_room00000000/result', label: strings.debateNote.openRoom },
    })
    expect([model.noAnswer, model.waits, model.answeredBy]).toEqual([null, null, null])
    const theirs = noteItemModel(
      threadInput({ conversations: [room], thread: { notes: [posted], hasMore: false } }),
      item({ ...posted, authorId: BEN, body: 'Edited by hand.' }),
    )
    expect(theirs.debateResult?.parts).toBeNull()
    expect(theirs.noAnswer).toBeNull()
    expect(noteItemModel(threadInput(), item(note('n'))).debateResult).toBeNull()
    const split = body
      .replace('Result: conclusion', 'Result: no conclusion')
      .replace('Reasons', 'Where they disagreed')
    expect(noteItemModel(threadInput(), item({ ...posted, body: split })).debateResult?.parts?.heading).toBe(
      strings.debateNote.disagreed,
    )
  })

  it('says in the status of a note to one person that their agent cannot answer, instead of waiting for a draft', () => {
    const unavailable = {
      directory: [
        entry(BEN, 'Ben', {
          presence: { humanOnline: false, agentOnline: true, agentUnavailable: { until: null } },
        }),
      ],
    }
    const label = (receipts: AsRead.Note['receipts']) =>
      noteItemModel(threadInput(unavailable), item(note('n1', { authorId: ANA, receipts }))).meta!.mark!.label
    expect(label([receipt(BEN)])).toBe(strings.deliveredAgentUnavailable)
    expect(label([receipt(BEN, { state: 'read', readAt: 2 })])).toBe(strings.readAgentUnavailable)
    expect(label([receipt(BEN, { state: 'replied', readAt: 2, repliedAt: 3 })])).toBe(strings.status.replied)
    expect(
      noteItemModel(threadInput(), item(note('n2', { authorId: ANA, receipts: [receipt(BEN)] }))).meta!.mark!
        .label,
    ).toBe(strings.status.delivered)
  })

  it('shows the person’s own note with its state, its basis, and nothing to answer', () => {
    const mine = note('n1', {
      authorId: ANA,
      origin: 'agent',
      basis: 'Read the runbook.',
      receipts: [receipt(BEN, { state: 'read', readAt: 2 })],
    })
    const model = noteItemModel(threadInput(), item(mine))
    expect(model.className).toBe('note is-mine leads-run is-agent')
    expect(model.author!.line).toBe(strings.authorship.agentYou)
    expect(model.basis).toEqual({
      className: 'note-basis is-mine',
      title: strings.basedOn,
      lines: ['Read the runbook.'],
      sources: [],
    })
    expect([model.reply, model.menu.items.map((one) => one.kind)]).toEqual([null, ['copy', 'copy-link']])
    expect(model.meta!.mark).toMatchObject({ state: 'read', label: strings.status.read, count: null })
    expect(model.meta!.mark!.glyph).toBe('✓✓︎')
    expect(noteItemModel(threadInput(), item(note('n2', { authorId: ANA, basis: null }))).basis).toBeNull()
    expect(noteItemModel(threadInput(), item(note('n5', { basis: 'Read the runbook.' }))).basis).toBeNull()
    expect(
      noteItemModel(threadInput(), item(note('n3', { authorId: ANA, origin: 'human_edited' }))).author!.line,
    ).toBe(strings.authorship.editedYou)
    expect(noteItemModel(threadInput(), item(note('n4', { authorId: ANA }))).author!.line).toBe(
      strings.authorship.personYou,
    )
  })

  it('counts reads in a group, and speaks a note that follows a run instead of showing its author', () => {
    const group = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })
    const mine = note('n1', {
      authorId: ANA,
      sentAt: 3,
      receipts: [
        receipt(BEN, { readAt: 2, state: 'read' }),
        receipt(CY, { state: 'drafting', draftingAt: 2 }),
      ],
    })
    const next = note('n2', { authorId: ANA, sentAt: 4 })
    const model = noteItemModel(
      threadInput({ conversations: [group] }),
      item(mine, { leadsRun: false, next }),
    )
    expect(model.author).toBeNull()
    expect(model.spokenAuthorship).toBe(strings.authorship.personYou)
    expect(model.authorName).toBeNull()
    expect(model.bubbleTitle).toBe(formats.full.format(new Date(3)))
    expect(model.meta).toEqual({
      time: null,
      mark: expect.objectContaining({ label: strings.readByWhileDrafting({ read: 1, of: 2, drafting: 1 }) }),
    })
    const leading = noteItemModel(threadInput({ conversations: [group] }), item(note('n3', { sentAt: 3 })))
    expect(leading.authorName).toBe('Ben')
    const own = noteItemModel(threadInput({ conversations: [group] }), item(note('n4', { authorId: ANA })))
    expect(own.authorName).toBe(strings.you)
    expect(own.meta!.mark!.label).toBe(strings.readBy({ read: 0, of: 0 }))
  })

  it('reads a direct note’s state for one recipient, and the room’s for several', () => {
    const toTwo = note('n1', { authorId: ANA, receipts: [receipt(BEN), receipt(CY)] })
    expect(noteItemModel(threadInput(), item(toTwo)).meta!.mark).toMatchObject({
      label: strings.readBy({ read: 0, of: 2 }),
      count: strings.readCount({ read: '0', of: '2' }),
    })
  })

  it('hides the meta line inside a run whose mark does not change', () => {
    const first = note('n1', { authorId: ANA, sentAt: 1 })
    const next = note('n2', { authorId: ANA, sentAt: 2 })
    expect(noteItemModel(threadInput(), item(first, { next })).meta).toBeNull()
    const theirs = note('n3', { sentAt: null })
    expect(noteItemModel(threadInput(), item(theirs)).meta).toEqual({ time: null, mark: null })
    expect(noteItemModel(threadInput(), item(theirs)).spokenSent).toBeNull()
  })

  it('quotes the note it answers', () => {
    const question = note('q', { body: 'When do we ship?' })
    const answer = note('a', { inReplyTo: 'q' as never })
    expect(
      noteItemModel(threadInput({ thread: { notes: [question, answer], hasMore: false } }), item(answer))
        .quote,
    ).toBe('When do we ship?')
  })

  it('says under the person’s latest unanswered question in a channel who answers, then that it is drafted', () => {
    const room = conversation({ kind: 'channel', participantIds: [ANA, BEN, CY] })
    const billing = {
      ...channel('billing', { conversationId: ROOM }),
      agent: { id: CY, name: 'Billing helper', presence: { humanOnline: false, agentOnline: true } },
    }
    const older = note('q1', { authorId: ANA, sentAt: 1 })
    const latest = note('q2', { authorId: ANA, sentAt: 2, receipts: [receipt(CY)] })
    const waits = (notes: AsRead.Note[], shown: AsRead.Note) =>
      noteItemModel(
        threadInput({ conversations: [room], channels: [billing], thread: { notes, hasMore: false } }),
        item(shown),
      ).waits
    expect(waits([older, latest], latest)).toEqual({
      text: strings.channelAnswer.agentDrafts({ agent: 'Billing helper' }),
      warning: false,
    })
    expect(waits([older, latest], older)).toBeNull()
    const picked = { ...latest, receipts: [receipt(CY, { state: 'drafting', draftingAt: 3 })] }
    expect(waits([older, picked], picked)?.text).toBe(
      strings.channelAnswer.agentDrafting({ agent: 'Billing helper' }),
    )
    const answer = note('a1', { authorId: CY, inReplyTo: latest.id, sentAt: 4 })
    expect(waits([latest, answer], latest)).toBeNull()
    expect(waits([latest], note('t1', { authorId: BEN }))).toBeNull()
    const ownReply = note('r1', { authorId: ANA, inReplyTo: answer.id, sentAt: 5 })
    expect(waits([latest, answer, ownReply], ownReply)).toBeNull()
    const mine = noteItemModel(
      threadInput({
        conversations: [room],
        channels: [billing],
        thread: { notes: [latest], hasMore: false },
      }),
      item(latest),
    )
    expect([mine.waits === null, mine.noAnswer]).toEqual([false, null])
  })

  it('says a channel question has no answer yet until someone answers it or is answering it', () => {
    const room = conversation({ kind: 'channel', participantIds: [ANA, BEN] })
    const noAnswerFor = (question: ReturnType<typeof note>, conversations = [room]) =>
      noteItemModel(
        threadInput({ conversations, thread: { notes: [question], hasMore: false } }),
        item(question),
      ).noAnswer
    expect(noAnswerFor(note('q', { receipts: [receipt(BEN, { state: 'read', readAt: 2 })] }))).toBe(
      strings.noAnswerYet,
    )
    expect(
      noAnswerFor(note('q', { receipts: [receipt(BEN, { state: 'drafting', draftingAt: 2 })] })),
    ).toBeNull()
    expect(
      noAnswerFor(note('q', { receipts: [receipt(BEN, { state: 'replied', repliedAt: 3 })] })),
    ).toBeNull()
    expect(noAnswerFor(note('q', { inReplyTo: 'q0' as never }))).toBeNull()
    const answered = noteItemModel(
      threadInput({
        conversations: [room],
        thread: {
          notes: [note('q'), note('a', { inReplyTo: 'q' as never }), draft('d', { inReplyTo: 'q' as never })],
          hasMore: false,
        },
      }),
      item(note('q')),
    )
    expect(answered.noAnswer).toBeNull()
    expect(noAnswerFor(note('q'), [{ ...room, archivedAt: 5 }])).toBeNull()
    expect(noAnswerFor(note('q'), [conversation()])).toBeNull()
  })

  it('names who answered a channel question, and offers to move one nobody answered', () => {
    const room = conversation({ kind: 'channel', participantIds: [ANA, BEN] })
    const answered = note('q', {
      receipts: [
        receipt(CY, { state: 'replied', repliedAt: 3 }),
        receipt(BEN, { state: 'replied', repliedAt: 3 }),
      ],
    })
    const model = noteItemModel(
      threadInput({ conversations: [room], thread: { notes: [answered], hasMore: false } }),
      item(answered),
    )
    expect(model.answeredBy!.text).toBe(strings.answeredBy({ names: `${strings.formerMember} and Ben` }))
    expect(model.menu.items.map((one) => one.kind)).toEqual(['reply', 'ask-agent', 'copy', 'copy-link'])
    const open = note('q2')
    const withoutRequests = noteItemModel(
      threadInput({ conversations: [room], serverInfo: serverInfo() }),
      item(open),
    )
    expect([withoutRequests.reply, withoutRequests.menu.items[1]]).toEqual([
      strings.reply,
      { kind: 'ask-agent', label: strings.askAgentToReply, reason: strings.askAgentOff },
    ])
  })

  it('says why the person’s agent cannot be asked while their desk runs but it cannot answer', () => {
    const theirs = note('n1')
    const unavailable = entry(ANA, 'Ana', {
      presence: {
        humanOnline: true,
        agentOnline: true,
        agentUnavailable: { kind: 'usage_limit', until: null },
      },
    })
    const model = noteItemModel(
      threadInput({ thread: { notes: [theirs], hasMore: false }, directory: [unavailable] }),
      item(theirs),
    )
    expect(model.menu.items.find((one) => one.kind === 'ask-agent')?.reason).toBe(
      strings.deskUnavailableReason.usage_limit,
    )
  })

  it('says why the person’s agent let a note go, and offers to ask it anyway', () => {
    const theirs = note('n1')
    const releases = new Map([[theirs.id, { reason: 'Out of scope', agentName: 'Desk' }]])
    expect(noteItemModel(threadInput({ releases }), item(theirs)).release).toEqual({
      text: strings.agentReleased({ reason: 'Out of scope' }),
      askAnyway: strings.askAnyway,
    })
    const silent = new Map([[theirs.id, { reason: '  ', agentName: null }]])
    expect(
      noteItemModel(threadInput({ releases: silent, serverInfo: serverInfo() }), item(theirs)).release,
    ).toEqual({
      text: strings.agentReleasedWithoutReason,
      askAnyway: null,
    })
    const none = new Map([[theirs.id, { reason: null, agentName: null }]])
    expect(noteItemModel(threadInput({ releases: none }), item(theirs)).release!.text).toBe(
      strings.agentReleasedWithoutReason,
    )
  })

  it('offers nothing to answer in an archived room', () => {
    const archived = conversation({ archivedAt: 5 })
    const model = noteItemModel(
      threadInput({
        conversations: [archived],
        releases: new Map([['n1' as never, { reason: null, agentName: null }]]),
      }),
      item(note('n1')),
    )
    expect([model.reply, model.menu.items.map((one) => one.kind)]).toEqual([null, ['copy', 'copy-link']])
    expect(model.release).toBeNull()
    expect(ROOM).toBe(archived.id)
  })
})

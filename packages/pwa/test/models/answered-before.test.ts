import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { answeredBeforeModel, openQuestionsLike, questionToLookUp } from '../../src/models/answered-before.ts'
import { durationOf, strings } from '../../src/strings.ts'
import { ANA, BEN, CHANNEL_ROOM, CY, member, note } from '../support/fixtures.ts'

const NOW = Date.UTC(2026, 10, 19, 12)

const found = (fields: Partial<AsRead.EarlierAnswer> = {}): AsRead.EarlierAnswer => ({
  question: note('q1', { authorId: ANA, body: 'Where do we keep the release calendar?' }),
  answer: note('a1', {
    authorId: BEN,
    body: 'In Drive, under Releases.',
    inReplyTo: 'q1' as never,
    conversationId: CHANNEL_ROOM,
    sentAt: NOW - 60_000,
  }),
  channel: 'wiki',
  ...fields,
})

const input = (fields: Partial<Parameters<typeof answeredBeforeModel>[0]> = {}) => ({
  found: [found()],
  dismissed: false,
  answered: false,
  members: new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben')],
    [CY, member(CY, 'Cy')],
  ]),
  now: NOW,
  ...fields,
})

describe('answeredBeforeModel', () => {
  it('shows each earlier answer with its question, who approved it, where, when and a link to the thread', () => {
    const model = answeredBeforeModel(input())
    expect(model).toEqual({
      kind: 'shown',
      title: strings.answeredBefore.title,
      lead: strings.answeredBefore.lead,
      keepWriting: strings.answeredBefore.keepWriting,
      items: [
        {
          answerId: 'a1',
          question: 'Where do we keep the release calendar?',
          answer: 'In Drive, under Releases.',
          approvedBy: strings.answeredBefore.approvedBy({ name: 'Ben' }),
          place: strings.answeredBefore.inChannel({ channel: 'wiki' }),
          time: expect.objectContaining({ datetime: new Date(NOW - 60_000).toISOString() }),
          href: `#/c/${CHANNEL_ROOM}`,
          open: strings.answeredBefore.open,
          thisAnswersIt: strings.answeredBefore.thisAnswersIt,
        },
      ],
      asked: [],
    })
  })

  it('shows a question still open in the room, who asked it and how long ago, with or without earlier answers', () => {
    const asked = note('q2', {
      authorId: BEN,
      body: 'What is the refund rule for annual plans?',
      conversationId: CHANNEL_ROOM,
      sentAt: NOW - 40 * 60_000,
    })
    const open = [{ question: asked, waitsForYourReview: true }]
    const model = answeredBeforeModel(input({ found: [], open }))
    expect(model).toMatchObject({
      kind: 'shown',
      title: strings.answeredBefore.askedTitle,
      lead: strings.answeredBefore.askedLead,
      items: [],
      asked: [
        {
          questionId: 'q2',
          question: 'What is the refund rule for annual plans?',
          asked: strings.answeredBefore.askedBy({ elapsed: durationOf(40 * 60_000), name: 'Ben' }),
          review: strings.answeredBefore.waitsForYourReview,
          href: `#/c/${CHANNEL_ROOM}?note=q2`,
          open: strings.answeredBefore.openQuestion,
        },
      ],
    })
    const both = answeredBeforeModel(
      input({
        open: [
          {
            question: { ...asked, sentAt: null, createdAt: NOW, authorId: 'mem_gone00000000' as never },
            waitsForYourReview: false,
          },
        ],
      }),
    )
    expect(both).toMatchObject({
      title: strings.answeredBefore.title,
      asked: [
        {
          asked: strings.answeredBefore.askedBy({ elapsed: durationOf(60_000), name: strings.formerMember }),
          review: null,
        },
      ],
    })
  })

  it('names the manager who approved a channel agent’s answer, and a former member when nobody is known', () => {
    const approved = found({ answer: { ...found().answer, approvedBy: CY } })
    const items = (given: AsRead.EarlierAnswer) => {
      const model = answeredBeforeModel(input({ found: [given] }))
      return model.kind === 'shown' ? model.items : []
    }
    expect(items(approved)[0]!.approvedBy).toBe(strings.answeredBefore.approvedBy({ name: 'Cy' }))
    const gone = found({ answer: { ...found().answer, authorId: 'mem_gone00000000' as never } })
    expect(items(gone)[0]!.approvedBy).toBe(strings.answeredBefore.approvedBy({ name: strings.formerMember }))
  })

  it('names no channel for a direct message, and dates an answer without a send time by its creation', () => {
    const direct = found({ channel: null, answer: { ...found().answer, sentAt: null, createdAt: NOW - 1 } })
    const model = answeredBeforeModel(input({ found: [direct] }))
    expect(model.kind === 'shown' && model.items[0]!.place).toBeNull()
    expect(model.kind === 'shown' && model.items[0]!.time.datetime).toBe(new Date(NOW - 1).toISOString())
  })

  it('shortens long questions and answers to one line', () => {
    const long = found({
      question: { ...found().question, body: `${'q'.repeat(200)}\nmore` },
      answer: { ...found().answer, body: 'a'.repeat(400) },
    })
    const model = answeredBeforeModel(input({ found: [long] }))
    expect(model.kind === 'shown' && model.items[0]!.question).toHaveLength(120)
    expect(model.kind === 'shown' && model.items[0]!.answer).toHaveLength(240)
  })

  it('shows nothing when nothing was found or the person chose to keep writing', () => {
    expect(answeredBeforeModel(input({ found: [] }))).toEqual({ kind: 'none' })
    expect(answeredBeforeModel(input({ dismissed: true }))).toEqual({ kind: 'none' })
  })

  it('says nothing was sent once the person said an earlier answer answers it', () => {
    expect(answeredBeforeModel(input({ answered: true }))).toEqual({
      kind: 'answered',
      text: strings.answeredBefore.answered,
    })
  })
})

describe('questionToLookUp', () => {
  it('looks up the trimmed question once it has a word worth matching', () => {
    expect(questionToLookUp('  Where is the release calendar?  ', false)).toBe(
      'Where is the release calendar?',
    )
  })

  it('looks up nothing for a reply, a blank or only common words', () => {
    expect(questionToLookUp('Where is the release calendar?', true)).toBeNull()
    expect(questionToLookUp('   ', false)).toBeNull()
    expect(questionToLookUp('Where is it?', false)).toBeNull()
  })

  it('looks up at most as much of a question as the server reads', () => {
    expect(questionToLookUp(`release ${'x'.repeat(3000)}`, false)).toHaveLength(2000)
  })
})

describe('openQuestionsLike', () => {
  const question = (id: string, body: string, fields = {}) =>
    note(id, { authorId: BEN, body, conversationId: CHANNEL_ROOM, ...fields })

  it('finds a sent question nobody answered that shares the words being typed, and says when a review waits', () => {
    const open = question('q1', 'What is the refund rule for annual plans?')
    const answered = question('q2', 'Refund rule for annual plans in Germany?')
    const reply = note('a2', { authorId: ANA, inReplyTo: 'q2' as never, conversationId: CHANNEL_ROOM })
    const unrelated = question('q3', 'Where is the release calendar?')
    const draftAnswer = note('d1', { authorId: CY, inReplyTo: 'q1' as never, status: 'draft' })
    const reviews = [{ note: { ...draftAnswer, inReplyTo: 'q1' } } as unknown as AsRead.Review]
    expect(
      openQuestionsLike(
        'Refund rule for annual plans cancelled halfway?',
        [open, answered, reply, unrelated, draftAnswer],
        reviews,
      ),
    ).toEqual([{ question: open, waitsForYourReview: true }])
    expect(openQuestionsLike('Refund rule for annual plans?', [open], [])).toEqual([
      { question: open, waitsForYourReview: false },
    ])
  })

  it('finds nothing while nothing worth looking up is typed, and never a draft or a reply', () => {
    expect(openQuestionsLike('  ', [question('q1', 'refund rule annual')], [])).toEqual([])
    expect(
      openQuestionsLike(
        'refund rule annual',
        [
          question('q1', 'refund rule annual', { status: 'draft' }),
          question('q2', 'refund rule annual', { inReplyTo: 'q0' }),
        ],
        [],
      ),
    ).toEqual([])
  })
})

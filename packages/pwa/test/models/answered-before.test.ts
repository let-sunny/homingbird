import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { answeredBeforeModel, questionToLookUp } from '../../src/models/answered-before.ts'
import { strings } from '../../src/strings.ts'
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

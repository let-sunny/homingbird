import { describe, expect, it } from 'vitest'
import { answeringFlowInstructions } from '../../src/drafting/answering-flow-instructions.ts'
import { quotedDebate, quotedDrafts } from '../../src/drafting/debate-prompts.ts'
import {
  ballotReaderPrompt,
  describedDebateForWriter,
  extractedRoom,
} from '../../src/drafting/debate-reader.ts'
import {
  debateToolAdvice,
  draftRequestText,
  noteToAnswerText,
  waitingNoteText,
} from '../../src/drafting/mcp-prompts.ts'
import { describedForWriter } from '../../src/drafting/note-reader.ts'
import {
  helperFactsFor,
  helperMessageFor,
  helperPromptFor,
  notePromptFor,
  replyPromptFor,
  requestPromptFor,
} from '../../src/drafting/plugin-prompts.ts'
import { quotedNoteWithState, quotedNotesWithState, quotedThread } from '../../src/drafting/quote-note.ts'
import {
  runnerExtractedNotePrompt,
  runnerNotePrompt,
  runnerRequestPrompt,
} from '../../src/drafting/runner-prompts.ts'
import { ANA, BEN, NO_CONCLUSION, PEOPLE, roomOf } from '../debate-fixtures.ts'
import { ANA as ANA_MEMBER, noteOf, quotingOf, requestOf } from './drafting-fixtures.ts'

// Every prompt in full, once with each optional part and once without, so that a changed word,
// a dropped section or a section in another place is a failing test.

const PERSON = { name: 'Ana' }
const NOTE = '<colleague-note id="n">…</colleague-note>'
const REQUEST = {
  id: 'dreq_r',
  conversationId: 'conv_c',
  inReplyTo: 'note_n',
  instruction: ' Say yes. ',
  answers: NOTE,
}

describe('the runner’s prompts in full', () => {
  it.each([
    ['a note', () => runnerNotePrompt(PERSON, 'GUIDANCE', NOTE)],
    ['a note without guidance', () => runnerNotePrompt(PERSON, '', NOTE)],
    ['an extracted note', () => runnerExtractedNotePrompt(PERSON, 'GUIDANCE', NOTE)],
    ['an extracted note without guidance', () => runnerExtractedNotePrompt(PERSON, '', NOTE)],
    ['a request', () => runnerRequestPrompt(PERSON, 'GUIDANCE', ' Say yes. ', NOTE, false)],
    ['a bare request', () => runnerRequestPrompt(PERSON, '', '', null, false)],
    ['an extracted request', () => runnerRequestPrompt(PERSON, '', 'Say yes.', NOTE, true)],
  ])('%s', (_, prompt) => {
    expect(prompt()).toMatchSnapshot()
  })
})

describe('the plugin desk’s prompts in full', () => {
  it.each([
    ['a note', () => notePromptFor('note_n', NOTE, 'FLOW')],
    ['a note without a flow', () => notePromptFor('note_n', NOTE)],
    ['a request', () => requestPromptFor(REQUEST, 'FLOW')],
    [
      'a bare request',
      () => requestPromptFor({ ...REQUEST, instruction: '', inReplyTo: null, answers: null }),
    ],
    ['a quiet reply', () => replyPromptFor(NOTE, 'FLOW')],
    ['a quiet reply without a flow', () => replyPromptFor(NOTE)],
    ['a helper prompt', () => helperPromptFor('/work', 'Which table?', NOTE)],
    ['a helper prompt without a note', () => helperPromptFor('/work', 'Which table?', null)],
    ['a helper message', () => helperMessageFor('Which table?', NOTE)],
    ['a helper message without a note', () => helperMessageFor('Which table?', null)],
    ['the helper’s facts', () => helperFactsFor('/work', ' Uses Postgres. ')],
  ])('%s', (_, prompt) => {
    expect(prompt()).toMatchSnapshot()
  })
})

describe('the MCP texts in full', () => {
  it.each([
    ['a note to answer', () => noteToAnswerText('note_n', 'GUIDANCE', NOTE)],
    ['a note to answer without guidance', () => noteToAnswerText('note_n', '', NOTE)],
    ['a note being drafted', () => waitingNoteText('note_n', true, NOTE)],
    ['a note nobody drafts', () => waitingNoteText('note_n', false, NOTE)],
    ['a request', () => draftRequestText(requestOf({ instruction: ' Ask Ben. ' }), 'GUIDANCE', NOTE)],
    ['a bare request', () => draftRequestText(requestOf(), '', null)],
  ])('%s', (_, prompt) => {
    expect(prompt()).toMatchSnapshot()
  })
})

describe('the quoted notes in full', () => {
  it('joins a note and its state with one line break, and notes and threads with a blank line', () => {
    const second = noteOf({ id: 'note_note11111111' as never })
    expect(quotedNoteWithState(noteOf(), quotingOf())).toMatchSnapshot()
    expect(quotedNotesWithState([noteOf(), second], quotingOf())).toMatchSnapshot()
    expect(
      quotedThread([noteOf({ authorId: ANA_MEMBER.id }), second], ANA_MEMBER.id, quotingOf()),
    ).toMatchSnapshot()
  })
})

describe('the debate texts in full', () => {
  const sequential = () => {
    let count = 0
    return () => `nonce${String(count++).padStart(15, '0')}`
  }
  const voting = roomOf({
    status: 'concluding',
    result: null,
    votingClosesAt: 5,
    drafts: [
      { ...NO_CONCLUSION, draftedBy: BEN },
      { ...roomOf().result!, draftedBy: ANA },
    ],
  } as never)

  it.each([
    ['a closed flock', () => quotedDebate(roomOf(), PEOPLE, ANA, sequential())],
    [
      'an open flock without turns or participants',
      () =>
        quotedDebate(
          roomOf({ status: 'open', turns: [], participants: [], result: null, voteRecord: null } as never),
          PEOPLE,
          ANA,
          sequential(),
        ),
    ],
    ['the drafts put to a vote', () => quotedDrafts(voting, PEOPLE, ANA, sequential())],
    ['a ballot for the reader', () => ballotReaderPrompt('ROOM', 'DRAFTS')],
    [
      'an extracted flock',
      () =>
        extractedRoom(
          roomOf({ status: 'open' }),
          ANA,
          {
            question: 'Ship?',
            positions: [{ memberId: BEN, position: 'No' }],
            openPoints: ['Load', 'Rollback'],
            language: 'en',
            drafts: [{ draftBy: BEN, gist: 'Wait a week' }],
          },
          PEOPLE,
          sequential(),
        ),
    ],
    [
      'an extraction without positions, points or drafts',
      () =>
        describedDebateForWriter(
          { question: 'Ship?', positions: [], openPoints: [], language: 'ko' },
          (id) => PEOPLE.get(id)?.name ?? '?',
        ),
    ],
    [
      'an extracted note',
      () =>
        describedForWriter({
          kind: 'question',
          topic: 'Billing',
          asks: 'When',
          needs: [],
          deadline: null,
          language: 'en',
        }),
    ],
    [
      'an extracted note with needs and a deadline',
      () =>
        describedForWriter({
          kind: 'request',
          topic: 'Billing',
          asks: 'When',
          needs: ['date', 'owner'],
          deadline: '2026-12-01',
          language: 'en',
        }),
    ],
  ])('%s', (_, text) => {
    expect(text()).toMatchSnapshot()
  })
})

describe('what a flock asks of the agent, in its edge cases', () => {
  it('asks a flock still waiting for its result for a draft only from an agent with none in it', () => {
    const concluding = roomOf({
      status: 'concluding',
      result: null,
      votingClosesAt: null,
      drafts: undefined,
    } as never)
    expect(debateToolAdvice(concluding, ANA)).toContain('call draft_debate_result')
    const someoneElse = { ...concluding, drafts: [{ ...roomOf().result!, draftedBy: BEN }] } as never
    expect(debateToolAdvice(someoneElse, ANA)).toContain('call draft_debate_result')
    expect(debateToolAdvice(roomOf({ status: 'concluding', votingClosesAt: null }), ANA)).toBe(
      'This flock asks nothing of you now.',
    )
    expect(debateToolAdvice(roomOf({ status: 'closed', result: null, votingClosesAt: null }), ANA)).toBe(
      'This flock asks nothing of you now.',
    )
  })

  it('asks for a vote only while a concluding flock without a result has a vote open', () => {
    const open = { status: 'concluding', result: null, votingClosesAt: 5, votedBy: [] } as const
    expect(debateToolAdvice(roomOf(open as never), ANA)).toContain('call vote_debate_result')
    expect(debateToolAdvice(roomOf({ ...open, status: 'closed' } as never), ANA)).not.toContain('vote')
    expect(debateToolAdvice(roomOf({ ...open, result: roomOf().result } as never), ANA)).not.toContain('vote')
  })
})

describe('the answering flow’s instructions in full', () => {
  it.each([
    ['steps only', { before: ['Look it up.'], checks: [] }],
    ['checks only', { before: [], checks: ['Nothing confidential.'] }],
    ['both', { before: ['Look it up.', 'Answer briefly.'], checks: ['Nothing confidential.'] }],
  ])('%s', (_, flow) => {
    expect(answeringFlowInstructions(flow)).toMatchSnapshot()
  })
})

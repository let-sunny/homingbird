import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { exportLabelsIn } from '../src/debate-export-labels.ts'
import {
  debateFilename,
  debateJson,
  debateMarkdown,
  debateResultText,
  escapeMarkdown,
} from '../src/debate-export.ts'
import { DebateResult } from '../src/debate-result.ts'
import type { Locale } from '../src/model.ts'
import { ANA, BEN, GONE, NO_CONCLUSION, nameOf, resultOf, roomOf } from './debate-fixtures.ts'

/** The text a Markdown reader acts on: every backslash-escaped mark replaced by an inert letter. */
const unescaped = (text: string): string => text.replace(/\\[\s\S]/g, 'x')

const HOSTILE = fc.oneof(
  fc.string(),
  fc.stringMatching(/^[\s\S]{0,8}[\r\u2028\u2029][-=*_ #]{0,6}$/),
  fc.constantFrom(
    '# heading',
    'text\n===',
    'text\n---',
    'text\r===',
    'text\r\n---',
    'text\u2028===',
    'text\u2029# heading',
    'a\n- - -\nb',
    'a\n***\nb',
    'a\n_ _ _',
    '<script>alert(1)</script>',
    '[click](javascript:alert(1))',
    '<https://evil.example>',
    'javascript:alert(1)',
    'mailto:ana@example.com',
    '![x](data:image/png;base64,AAAA)',
    '\\# escaped already',
    '`code` *em* _em_ | table |',
  ),
)

describe('exporting a debate room', () => {
  it('writes the transcript and the conclusion as Markdown, naming people by display name only', () => {
    const text = debateMarkdown(roomOf(), nameOf)
    expect(text).toMatch(/^# Debate room: Should we ship the billing migration this week\?/)
    expect(text).toContain('- Created: 2026-11-02T09:00:00.000Z by Ana')
    expect(text).toContain('- Participants: Ana (agent: Laptop), Ben (agent: Desk)')
    expect(text).toContain(
      '### 1. Ana’s agent (Laptop; model: not stated), 2026-11-02T09:05:00.000Z\n\n> The March report\n> says the rollback failed.',
    )
    expect(text).toContain(
      '## Result: conclusion\n\nDrafted by Ana’s agent (model: not stated)\n\n> Ship on Thursday.\n\n### Reasons\n\n- The rollback is tested.',
    )
    expect(text).toContain('- Share the rollback plan. (owner: Ben; proposed by Ana’s agent)')
    expect(text).toContain('- Decide the date. (owner: not named; proposed by Ben’s agent)')
    expect(text).toContain('- Ana’s agent: Named the March report. (filled a gap)')
    expect(text).toContain('- Ben’s agent: Changed position.\n')
    expect(text).toContain(
      '## Vote\n\n- Ben’s agent (model: not stated) voted for Ana’s draft\n- Ana’s agent did not vote in time',
    )
    expect(text).not.toContain(ANA)
  })

  it('writes what changed minds, what is still open and where the agents differed, with the turn of each credit', () => {
    const settled = roomOf().result!
    const result = {
      ...resultOf(roomOf()),
      kind: 'conclusion' as const,
      conclusion: 'Ship on Thursday.',
      reasons: ['The rollback is tested.'],
      changedMinds: [{ turn: 1, line: 'The failed rehearsal moved Ben.' }],
      stillOpen: ['Is the vendor term in the order form?'],
      points: [
        { point: 'Date', category: 'goals' as const, explanation: 'Ben wanted Friday for the quarter.' },
      ],
      contributions: [
        {
          memberId: ANA,
          summary: 'Named the March report.',
          credits: [{ credit: 'gap_filled' as const, turn: 1 }],
        },
        { memberId: BEN, summary: 'Changed position.', credits: [] },
      ],
    }
    for (const [language, expected] of [
      [
        'en',
        [
          '### What changed minds\n\n- Turn 1: The failed rehearsal moved Ben.',
          '### Still open\n\n- Is the vendor term in the order form?',
          '### Where they differed\n\n- Date (goals): Ben wanted Friday for the quarter.',
          '- Ana’s agent: Named the March report. (filled a gap in turn 1)',
        ],
      ],
      [
        'ko',
        [
          '### 생각을 바꾼 차례\n\n- 1번째 차례: The failed rehearsal moved Ben.',
          '### 아직 열린 질문',
          '### 의견이 달랐던 곳',
          '(1번째 차례에서 빠진 정보를 채웠어요)',
        ],
      ],
    ] as const) {
      const text = debateMarkdown(
        roomOf({ result: { ...settled, result } }),
        nameOf,
        exportLabelsIn(language),
      )
      for (const line of expected) expect(text).toContain(line)
    }
    const plain = debateMarkdown(roomOf(), nameOf)
    expect(plain).not.toContain('What changed minds')
    expect(plain).not.toContain('Still open')
    expect(plain).not.toContain('Where they differed')
  })

  it('names the model each agent stated beside its turn, its draft and its vote', () => {
    const room = roomOf()
    const stated = roomOf({
      turns: room.turns.map((turn) => ({
        ...turn,
        agentModel: turn.memberId === ANA ? 'claude-opus-5-5' : null,
      })),
      drafts: [
        { draftedBy: ANA, draftedAt: 3, result: resultOf(room), votes: 1, agentModel: 'gpt-6' },
        { draftedBy: BEN, draftedAt: 4, result: resultOf(room), votes: 0, agentModel: 'model-b' },
      ],
      voteRecord: { votes: [{ voterId: BEN, draftBy: ANA, agentModel: 'gemini 4' }], droppedOut: [] },
    })
    const text = debateMarkdown(stated, nameOf)
    expect(text).toContain('### 1. Ana’s agent (Laptop; model: claude-opus-5-5), ')
    expect(text).toContain('### 2. Ben’s agent (Desk; model: not stated), ')
    expect(text).toContain('## Result: conclusion\n\nDrafted by Ana’s agent (model: gpt-6)\n\n')
    expect(text).toContain('- Ben’s agent (model: gemini 4) voted for Ana’s draft')
    const korean = debateMarkdown(stated, nameOf, exportLabelsIn('ko'))
    expect(korean).toContain('### 2. Ben 님의 에이전트 (Desk; 모델: 밝히지 않음), ')
    expect(korean).toContain('Ana 님의 에이전트가 쓴 초안 (모델: gpt-6)')
    expect(korean).toContain('- Ben 님의 에이전트(모델: gemini 4)가 Ana 님의 초안에 투표했어요')
    const json = JSON.parse(debateJson(stated, nameOf))
    expect(json.turns.map((turn: { model: string | null }) => turn.model)).toEqual(['claude-opus-5-5', null])
    expect(json.result).toMatchObject({ draftedBy: 'Ana', model: 'gpt-6' })
    expect(json.vote.votes).toEqual([{ voter: 'Ben', model: 'gemini 4', votedFor: 'Ana' }])
    expect(JSON.parse(debateJson(roomOf(), nameOf)).result).toMatchObject({ draftedBy: 'Ana', model: null })
  })

  it('writes a "no conclusion" analysis per point, and says what is missing', () => {
    const text = debateMarkdown(
      roomOf({
        status: 'concluding',
        result: NO_CONCLUSION,
        voteRecord: null,
        turns: [],
        participants: [],
      }),
      nameOf,
    )
    expect(text).toContain(
      '## Result: no conclusion\n\nDrafted by Ben’s agent (model: not stated)\n\n> They did not agree.',
    )
    expect(text).toContain('- Risk (open question): Nobody knew the load.')
    expect(text).toContain('### Next steps\n\nNone proposed.')
    expect(text).toContain('(separated a disagreement)')
    expect(text).toContain('No turns were taken.')
    expect(text).toContain('- Participants: none')
    expect(text).not.toContain('## Vote')
    const ended = debateMarkdown(
      roomOf({ status: 'ended', endedBecause: 'no_turns', result: null, voteRecord: null }),
      nameOf,
    )
    expect(ended).toContain('- Status: ended (no turns were taken)')
    expect(ended).not.toContain('Turns stopped')
    expect(debateMarkdown(roomOf({ concludedBecause: 'agreed' }), nameOf)).toContain(
      '- Turns stopped: every agent agreed to conclude, before the turns ran out',
    )
    expect(debateMarkdown(roomOf({ concludedBecause: 'time' }), nameOf, exportLabelsIn('ko'))).toContain(
      '- 차례가 끝난 까닭: 시간이 다 됐어요',
    )
    expect(ended).toContain('## Result\n\nNo result was drafted.')
    expect(ended).not.toContain('## Vote')
    const alone = debateMarkdown(roomOf({ voteRecord: { votes: [], droppedOut: [BEN] }, drafts: [] }), nameOf)
    expect(alone).toContain('## Vote\n\nNo vote was held: the result was the only draft.')
    expect(debateMarkdown(roomOf({ voteRecord: { votes: [], droppedOut: [] } }), nameOf)).toContain(
      'No vote was held',
    )
    const dropped = debateMarkdown(
      roomOf({
        voteRecord: { votes: [{ voterId: ANA, draftBy: BEN }], droppedOut: [BEN] },
      }),
      nameOf,
    )
    expect(dropped).toContain(
      '- Ana’s agent (model: not stated) voted for Ben’s draft\n- Ben’s agent dropped out of the debate and did not vote',
    )
  })

  it('escapes what people and agents wrote, keeping plain http(s) addresses', () => {
    expect(escapeMarkdown('# Ship <b>now</b> [x](javascript:y) at https://wiki.example.com/a & b@c.d')).toBe(
      '\\# Ship &lt;b&gt;now&lt;/b&gt; \\[x\\]\\(javascript\\:y\\) at https://wiki.example.com/a &amp; b\\@c.d',
    )
    const quoted = debateMarkdown(
      roomOf({
        turns: [{ position: 1, memberId: ANA, agentName: 'Laptop', body: 'Title\n===\nx\n---', at: 1 }],
      }),
      nameOf,
    )
    expect(quoted).toContain('> Title\n> \\===\n> x\n> \\---')
  })

  it('escapes an underline padded with other whitespace, such as a vertical tab', () => {
    const quoted = debateMarkdown(
      roomOf({
        turns: [{ position: 1, memberId: ANA, agentName: 'Laptop', body: 'Title\n=\u000b \n-\t-', at: 1 }],
      }),
      nameOf,
    )
    expect(quoted).toContain('> Title\n> \\=\n> \\-\t-')
  })

  it('escapes a leading dash in a list item, so a reason of dashes makes no thematic break', () => {
    const conclusion = { kind: 'conclusion', conclusion: 'Ship.', contributions: [], nextSteps: [] } as const
    const text = debateMarkdown(
      roomOf({
        result: {
          result: { ...conclusion, reasons: ['--', '- -', '-5% churn'] },
          draftedBy: ANA,
          draftedAt: 2,
        },
      }),
      nameOf,
    )
    expect(text).toContain('- \\--\n- \\- -\n- \\-5% churn')
    expect(unescaped(text)).not.toMatch(/^(?:> ?)*(?:[-*_] *){3,}$/m)
  })

  it('lets no text a person or agent wrote add a heading, an HTML tag or a link but http(s), in either language', () => {
    const HEADINGS = {
      en: /^#{1,3} (?:Debate room: |Turns$|Result|Vote$|Reasons$|Where they disagreed$|Where they differed$|What changed minds$|Still open$|Next steps$|Contributions$|\d+\. )/,
      ko: /^#{1,3} (?:토론방: |차례$|결과|투표$|이유$|의견이 갈린 곳$|의견이 달랐던 곳$|생각을 바꾼 차례$|아직 열린 질문$|다음 단계$|기여$|\d+\. )/,
    } as const
    fc.assert(
      fc.property(
        HOSTILE,
        HOSTILE,
        arbitrary(DebateResult),
        fc.constantFrom<Locale>('en', 'ko'),
        HOSTILE,
        (question, turn, result, language, model) => {
          const settled = { ...result, contributions: [] }
          const text = debateMarkdown(
            roomOf({
              question,
              turns: [{ position: 1, memberId: ANA, agentName: turn, body: turn, at: 1, agentModel: model }],
              result: { result: settled, draftedBy: ANA, draftedAt: 2 },
              drafts: [{ draftedBy: ANA, draftedAt: 2, result: settled, votes: 1, agentModel: model }],
              voteRecord: { votes: [{ voterId: BEN, draftBy: ANA, agentModel: model }], droppedOut: [] },
            }),
            () => turn,
            exportLabelsIn(language),
          )
          const plain = unescaped(text)
          const headings = plain.split('\n').filter((line) => /^(?:> ?)*#/.test(line))
          for (const heading of headings) expect(heading).toMatch(HEADINGS[language])
          expect(plain).not.toMatch(/^(?:> ?)*(?:=+|-{2,}) *$/m)
          expect(plain).not.toMatch(/^(?:> ?)*(?:[-*_] *){3,}$/m)
          expect(plain).not.toMatch(/[\r\u2028\u2029]/)
          expect(plain).not.toMatch(/[<[\]`@]/)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('writes the headings and labels in Korean for a person who reads Korean, escaping the same', () => {
    const text = debateMarkdown(roomOf({ question: 'Ship *now*?' }), nameOf, exportLabelsIn('ko'))
    expect(text).toMatch(/^# 토론방: Ship \\\*now\\\*\?/)
    expect(text).toContain('- 공개 범위: 비공개')
    expect(text).toContain('- 상태: 닫힘')
    expect(text).toContain('- 만든 때: 2026-11-02T09:00:00.000Z, 만든 사람: Ana')
    expect(text).toContain('- 참여자: Ana (에이전트: Laptop), Ben (에이전트: Desk)')
    expect(text).toContain('### 1. Ana 님의 에이전트 (Laptop; 모델: 밝히지 않음), 2026-11-02T09:05:00.000Z')
    expect(text).toContain('## 결과: 결론')
    expect(text).toContain('- Share the rollback plan. (담당: Ben; 제안: Ana 님의 에이전트)')
    expect(text).toContain('- Decide the date. (담당: 정하지 않음; 제안: Ben 님의 에이전트)')
    expect(text).toContain('- Ana 님의 에이전트: Named the March report. (빠진 정보를 채웠어요)')
    expect(text).toContain('## 투표\n\n- Ben 님의 에이전트(모델: 밝히지 않음)가 Ana 님의 초안에 투표했어요')
    expect(text).not.toMatch(/Debate room|Turns|Vote/)
    const ended = debateMarkdown(
      roomOf({ status: 'ended', endedBecause: 'one_agent_left', result: null, turns: [], voteRecord: null }),
      nameOf,
      exportLabelsIn('ko'),
    )
    expect(ended).toContain(
      '- 상태: 결과 없이 끝남 (다른 에이전트들이 토론에서 이탈해 에이전트 하나만 남았어요)',
    )
    expect(ended).toContain('차례가 없었어요.')
    expect(ended).toContain('작성된 결과가 없어요.')
    expect(ended).not.toContain('## 투표')
  })

  it('leaves a colon in an escaped text only where an http(s) address starts', () => {
    fc.assert(
      fc.property(HOSTILE, (text) => {
        const plain = unescaped(escapeMarkdown(text))
        expect(plain.replace(/https?:\/\//gi, '')).not.toContain(':')
        expect(plain).not.toMatch(/[<>#[\]()`*_|~@!]/)
      }),
      { numRuns: 300 },
    )
  })

  it('writes the same room as JSON for tools, with names and ISO times and no member ids', () => {
    const parsed = JSON.parse(debateJson(roomOf({ createdBy: GONE }), nameOf))
    expect(JSON.parse(debateJson(roomOf({ concludedBecause: 'agreed' }), nameOf)).concludedBecause).toBe(
      'agreed',
    )
    expect(parsed).toMatchObject({
      createdBy: 'A former member',
      closedAt: '2026-11-02T09:45:00.000Z',
      endedBecause: null,
      concludedBecause: null,
      participants: [
        { name: 'Ana', agent: 'Laptop' },
        { name: 'Ben', agent: 'Desk' },
      ],
      turns: [
        {
          position: 1,
          participant: 'Ana',
          agent: 'Laptop',
          text: 'The March report\nsays the rollback failed.',
        },
        {},
      ],
      result: {
        kind: 'conclusion',
        contributions: [{ participant: 'Ana', credits: ['gap_filled'] }, { participant: 'Ben' }],
        nextSteps: [
          { step: 'Share the rollback plan.', owner: 'Ben', proposedBy: 'Ana' },
          { step: 'Decide the date.', owner: null, proposedBy: 'Ben' },
        ],
      },
    })
    expect(JSON.stringify(parsed)).not.toContain(BEN)
    const open = JSON.parse(debateJson(roomOf({ closedAt: null, result: null, voteRecord: null }), nameOf))
    expect(open).toMatchObject({
      closedAt: null,
      result: null,
      vote: null,
    })
    expect(JSON.parse(debateJson(roomOf(), nameOf)).vote).toEqual({
      votes: [{ voter: 'Ben', model: null, votedFor: 'Ana' }],
      droppedOut: [],
    })
  })

  it('writes the result alone as plain text that says where it came from, without the turns or the vote', () => {
    const room = roomOf({ question: 'Ship *now*?' })
    const text = debateResultText(room, resultOf(room), nameOf)
    expect(text).toMatch(/^From the debate room: Ship \*now\*\?\n\nResult: conclusion\n\nShip on Thursday\./)
    expect(text).not.toContain('The March report')
    expect(text).not.toMatch(/voted/i)
    expect(text).not.toMatch(/^#|\\/m)
    expect(debateResultText(room, NO_CONCLUSION.result, nameOf)).toContain('Where they disagreed')
  })

  it('names the file after the room', () => {
    expect(debateFilename(roomOf(), 'md')).toBe('debate-debate000000.md')
    expect(debateFilename(roomOf(), 'json')).toBe('debate-debate000000.json')
  })
})

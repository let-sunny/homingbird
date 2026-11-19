import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  debateFilename,
  debateJson,
  debateMarkdown,
  debateResultText,
  escapeMarkdown,
} from '../src/debate-export.ts'
import { DebateResult } from '../src/debate-result.ts'
import { ANA, BEN, GONE, NO_CONCLUSION, nameOf, roomOf } from './debate-fixtures.ts'

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
      '### 1. Ana’s agent (Laptop), 2026-11-02T09:05:00.000Z\n\n> The March report\n> says the rollback failed.',
    )
    expect(text).toContain(
      '## Result: conclusion\n\n> Ship on Thursday.\n\n### Reasons\n\n- The rollback is tested.',
    )
    expect(text).toContain('- Share the rollback plan. (owner: Ben; proposed by Ana’s agent)')
    expect(text).toContain('- Decide the date. (owner: not named; proposed by Ben’s agent)')
    expect(text).toContain('- Ana’s agent: Named the March report. (filled a gap)')
    expect(text).toContain('- Ben’s agent: Changed position.\n')
    expect(text).toContain('- Ben: approved 2026-11-02T09:45:00.000Z')
    expect(text).not.toContain(ANA)
  })

  it('writes a "no conclusion" analysis per point, and says what is missing', () => {
    const text = debateMarkdown(
      roomOf({
        status: 'concluding',
        result: NO_CONCLUSION,
        approvals: [{ memberId: ANA, approvedAt: null }],
        turns: [],
        participants: [],
      }),
      nameOf,
    )
    expect(text).toContain('## Result: no conclusion\n\n> They did not agree.')
    expect(text).toContain('- Risk (open question): Nobody knew the load.')
    expect(text).toContain('### Next steps\n\nNone proposed.')
    expect(text).toContain('(separated a disagreement)')
    expect(text).toContain('No turns were taken.')
    expect(text).toContain('- Participants: none')
    expect(text).toContain('- Ana: not approved')
    const ended = debateMarkdown(
      roomOf({ status: 'ended', endedBecause: 'no_turns', result: null, approvals: [] }),
      nameOf,
    )
    expect(ended).toContain('- Status: ended (no turns were taken)')
    expect(ended).toContain('## Result\n\nNo result was drafted.')
    expect(ended).toContain('## Approvals\n\nNobody has approved.')
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

  it('lets no text a person or agent wrote add a heading, an HTML tag or a link but http(s)', () => {
    fc.assert(
      fc.property(HOSTILE, HOSTILE, arbitrary(DebateResult), (question, turn, result) => {
        const text = debateMarkdown(
          roomOf({
            question,
            turns: [{ position: 1, memberId: ANA, agentName: turn, body: turn, at: 1 }],
            result: { result: { ...result, contributions: [] }, draftedBy: ANA, draftedAt: 2 },
          }),
          () => turn,
        )
        const plain = unescaped(text)
        const headings = plain.split('\n').filter((line) => /^(?:> ?)*#/.test(line))
        for (const heading of headings)
          expect(heading).toMatch(
            /^#{1,3} (?:Debate room: |Turns$|Result|Approvals$|Reasons$|Where they disagreed$|Next steps$|Contributions$|\d+\. )/,
          )
        expect(plain).not.toMatch(/^(?:> ?)*(?:=+|-{2,}) *$/m)
        expect(plain).not.toMatch(/^(?:> ?)*(?:[-*_] *){3,}$/m)
        expect(plain).not.toMatch(/[\r\u2028\u2029]/)
        expect(plain).not.toMatch(/[<[\]`@]/)
      }),
      { numRuns: 200 },
    )
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
    expect(parsed).toMatchObject({
      createdBy: 'A former member',
      closedAt: '2026-11-02T09:45:00.000Z',
      endedBecause: null,
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
    const open = JSON.parse(
      debateJson(
        roomOf({ closedAt: null, result: null, approvals: [{ memberId: BEN, approvedAt: null }] }),
        nameOf,
      ),
    )
    expect(open).toMatchObject({
      closedAt: null,
      result: null,
      approvals: [{ name: 'Ben', approvedAt: null }],
    })
  })

  it('writes the result alone as plain text that says where it came from, without the turns or approvals', () => {
    const room = roomOf({ question: 'Ship *now*?' })
    const text = debateResultText(room, room.result!.result, nameOf)
    expect(text).toMatch(/^From the debate room: Ship \*now\*\?\n\nResult: conclusion\n\nShip on Thursday\./)
    expect(text).not.toContain('The March report')
    expect(text).not.toMatch(/approved/i)
    expect(text).not.toMatch(/^#|\\/m)
    expect(debateResultText(room, NO_CONCLUSION.result, nameOf)).toContain('Where they disagreed')
  })

  it('names the file after the room', () => {
    expect(debateFilename(roomOf(), 'md')).toBe('debate-debate000000.md')
    expect(debateFilename(roomOf(), 'json')).toBe('debate-debate000000.json')
  })
})

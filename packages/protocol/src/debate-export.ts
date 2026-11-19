import type { DebateResult } from './debate-result.ts'
import type { Debate } from './debates.ts'
import type { MemberId } from './ids.ts'

/**
 * The whole room, transcript and result, as Markdown, with participants named by display name. Every
 * text a person or an agent wrote is escaped, so none of it can add a heading, an HTML tag or a link
 * other than a plain http(s) address.
 */
export const debateMarkdown = (debate: Debate, nameOf: (id: MemberId) => string): string => {
  const name = (id: MemberId) => MARKDOWN.inline(nameOf(id))
  return [
    `# Debate room: ${MARKDOWN.inline(debate.question)}`,
    [
      `- Visibility: ${debate.visibility}`,
      `- Status: ${debate.status}${debate.endedBecause === null ? '' : ` (${ENDINGS[debate.endedBecause]})`}`,
      `- Created: ${isoOf(debate.createdAt)} by ${name(debate.createdBy)}`,
      `- Limits: ${debate.limits.turnsPerAgent} turns per agent, ${debate.limits.totalTurns} in total, ${debate.limits.minutes} minutes, ${debate.limits.turnCharacters} characters per turn`,
      `- Participants: ${debate.participants.map((one) => `${name(one.memberId)} (agent: ${MARKDOWN.inline(one.agentName)})`).join(', ') || 'none'}`,
    ].join('\n'),
    '## Turns',
    ...(debate.turns.length === 0
      ? ['No turns were taken.']
      : debate.turns.map(
          (turn) =>
            `### ${turn.position}. ${name(turn.memberId)}’s agent (${MARKDOWN.inline(turn.agentName)}), ${isoOf(turn.at)}\n\n${MARKDOWN.block(turn.body)}`,
        )),
    ...(debate.result === null
      ? ['## Result', 'No result was drafted.']
      : resultIn(MARKDOWN, debate.result.result, nameOf)),
    '## Approvals',
    debate.approvals
      .map(
        (one) =>
          `- ${name(one.memberId)}: ${one.approvedAt === null ? 'not approved' : `approved ${isoOf(one.approvedAt)}`}`,
      )
      .join('\n') || 'Nobody has approved.',
  ].join('\n\n')
}

export const debateJson = (debate: Debate, nameOf: (id: MemberId) => string): string =>
  JSON.stringify(
    {
      question: debate.question,
      visibility: debate.visibility,
      status: debate.status,
      endedBecause: debate.endedBecause,
      createdBy: nameOf(debate.createdBy),
      createdAt: isoOf(debate.createdAt),
      closedAt: debate.closedAt === null ? null : isoOf(debate.closedAt),
      limits: debate.limits,
      participants: debate.participants.map((one) => ({ name: nameOf(one.memberId), agent: one.agentName })),
      turns: debate.turns.map((turn) => ({
        position: turn.position,
        participant: nameOf(turn.memberId),
        agent: turn.agentName,
        at: isoOf(turn.at),
        text: turn.body,
      })),
      result: debate.result === null ? null : namedResult(debate.result.result, nameOf),
      approvals: debate.approvals.map((one) => ({
        name: nameOf(one.memberId),
        approvedAt: one.approvedAt === null ? null : isoOf(one.approvedAt),
      })),
    },
    null,
    2,
  )

export const debateResultText = (
  debate: Debate,
  result: DebateResult,
  nameOf: (id: MemberId) => string,
): string =>
  [`From the debate room: ${PLAIN.inline(debate.question)}`, ...resultIn(PLAIN, result, nameOf)].join('\n\n')

export const debateFilename = (debate: Pick<Debate, 'id'>, extension: 'md' | 'json'): string =>
  `debate-${debate.id.slice(debate.id.indexOf('_') + 1)}.${extension}`

/** A colon stays only in `http://` and `https://`, so no other scheme can become a link. */
export const escapeMarkdown = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#!|~@]/g, '\\$&')
    .replace(/:/g, (colon, at: number, whole: string) =>
      /https?$/i.test(whole.slice(Math.max(0, at - 5), at)) && whole.startsWith('//', at + 1) ? colon : '\\:',
    )

interface Style {
  readonly heading: (level: 2 | 3, text: string) => string
  readonly inline: (text: string) => string
  readonly block: (text: string) => string
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const MARKDOWN: Style = {
  heading: (level, text) => `${'#'.repeat(level)} ${text}`,
  inline: (text) => escapeMarkdown(oneLine(text)),
  block: (text) =>
    text
      .replace(LINE_BREAKS, '\n')
      .split('\n')
      .map((line) =>
        `> ${RULE_OR_UNDERLINE.test(line) ? `\\${line.trim()}` : escapeMarkdown(line)}`.trimEnd(),
      )
      .join('\n'),
}

const PLAIN: Style = {
  heading: (_, text) => text,
  inline: oneLine,
  block: (text) => text.trim(),
}

const LINE_BREAKS = /\r\n?|\u2028|\u2029/g

/** A setext underline or a thematic break: dashes, equals signs or stars and underscores, spaced or not. */
const RULE_OR_UNDERLINE = /^\s*(?:(?:-\s*)+|(?:=\s*)+|(?:\*\s*){3,}|(?:_\s*){3,})$/

const ENDINGS = {
  too_few_agents: 'too few agents',
  no_turns: 'no turns were taken',
  no_result: 'no result was approved in time',
} as const

const CATEGORY_NAMES = {
  information: 'information',
  assumptions: 'assumptions',
  goals: 'goals',
  open_question: 'open question',
} as const

const CREDIT_NAMES = {
  gap_filled: 'filled a gap',
  disagreement_separated: 'separated a disagreement',
  position_changed: 'changed position on better evidence',
} as const

const resultIn = (style: Style, result: DebateResult, nameOf: (id: MemberId) => string): string[] => {
  const name = (id: MemberId) => style.inline(nameOf(id))
  return [
    style.heading(2, result.kind === 'conclusion' ? 'Result: conclusion' : 'Result: no conclusion'),
    ...(result.kind === 'conclusion'
      ? [
          style.block(result.conclusion),
          `${style.heading(3, 'Reasons')}\n\n${result.reasons.map((reason) => `- ${style.inline(reason)}`).join('\n')}`,
        ]
      : [
          style.block(result.summary),
          `${style.heading(3, 'Where they disagreed')}\n\n${result.points
            .map(
              (point) =>
                `- ${style.inline(point.point)} (${CATEGORY_NAMES[point.category]}): ${style.inline(point.explanation)}`,
            )
            .join('\n')}`,
        ]),
    `${style.heading(3, 'Next steps')}\n\n${
      result.nextSteps
        .map(
          (step) =>
            `- ${style.inline(step.step)} (owner: ${step.owner === null ? 'not named' : name(step.owner)}; proposed by ${name(step.proposedBy)}’s agent)`,
        )
        .join('\n') || 'None proposed.'
    }`,
    `${style.heading(3, 'Contributions')}\n\n${result.contributions
      .map(
        (one) =>
          `- ${name(one.memberId)}’s agent: ${style.inline(one.summary)}${one.credits.length === 0 ? '' : ` (${one.credits.map((credit) => CREDIT_NAMES[credit]).join(', ')})`}`,
      )
      .join('\n')}`,
  ]
}

const namedResult = (result: DebateResult, nameOf: (id: MemberId) => string) => ({
  ...result,
  contributions: result.contributions.map(({ memberId, ...rest }) => ({
    participant: nameOf(memberId),
    ...rest,
  })),
  nextSteps: result.nextSteps.map((step) => ({
    step: step.step,
    owner: step.owner === null ? null : nameOf(step.owner),
    proposedBy: nameOf(step.proposedBy),
  })),
})

const isoOf = (at: number): string => new Date(at).toISOString()

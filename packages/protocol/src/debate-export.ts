import { type ExportLabels, exportLabelsIn } from './debate-export-labels.ts'
import {
  type DebateResult,
  type DisagreementPoint,
  type NamedCredit,
  creditKindOf,
  creditTurnOf,
} from './debate-result.ts'
import type { Debate, DebateVoteRecord } from './debates.ts'
import { type DraftedDebateResult, draftedResultOf } from './drafted-result.ts'
import type { MemberId } from './ids.ts'

/**
 * The whole room, transcript and result, as Markdown, with participants named by display name and the
 * headings in the exporting person's language. Every text a person or an agent wrote is escaped, so none
 * of it can add a heading, an HTML tag or a link other than a plain http(s) address.
 */
export const debateMarkdown = (
  debate: Debate,
  nameOf: (id: MemberId) => string,
  labels: ExportLabels = exportLabelsIn(null),
): string => {
  const settled = draftedResultOf(debate.result)
  const name = (id: MemberId) => MARKDOWN.inline(nameOf(id))
  const model = (stated: string | null | undefined) =>
    stated == null ? labels.modelNotStated : MARKDOWN.inline(stated)
  const ending = debate.endedBecause === null ? '' : ` (${labels.endings[debate.endedBecause]})`
  return [
    `# ${labels.title(MARKDOWN.inline(debate.question))}`,
    [
      `- ${labels.visibility}: ${labels.visibilities[debate.visibility]}`,
      `- ${labels.status}: ${labels.statuses[debate.status]}${ending}`,
      ...(debate.concludedBecause == null
        ? []
        : [`- ${labels.concluded}: ${labels.conclusions[debate.concludedBecause]}`]),
      `- ${labels.created(isoOf(debate.createdAt), name(debate.createdBy))}`,
      `- ${labels.limits({
        perAgent: debate.limits.turnsPerAgent,
        total: debate.limits.totalTurns,
        minutes: debate.limits.minutes,
        characters: debate.limits.turnCharacters,
      })}`,
      `- ${labels.participants}: ${debate.participants.map((one) => labels.participantAgent(name(one.memberId), MARKDOWN.inline(one.agentName))).join(labels.listSeparator) || labels.none}`,
    ].join('\n'),
    `## ${labels.turns}`,
    ...(debate.turns.length === 0
      ? [labels.noTurns]
      : debate.turns.map(
          (turn) =>
            `### ${labels.turnHeading(turn.position, name(turn.memberId), MARKDOWN.inline(turn.agentName), model(turn.agentModel), isoOf(turn.at))}\n\n${MARKDOWN.block(turn.body)}`,
        )),
    ...(settled === null
      ? [`## ${labels.result}`, labels.noResult]
      : draftedResultIn(debate, settled, nameOf, labels, model)),
    ...(debate.voteRecord == null
      ? []
      : [
          `## ${labels.vote}`,
          voteLines(debate.voteRecord, debate, name, labels, (vote) => model(vote.agentModel)),
        ]),
  ].join('\n\n')
}

/** Each agent's vote, then those that dropped out or did not vote in time; or that there was no vote. */
export const voteLines = (
  record: DebateVoteRecord,
  debate: {
    readonly participants: ReadonlyArray<{ readonly memberId: MemberId }>
    readonly drafts?: ReadonlyArray<unknown> | undefined
  },
  name: (id: MemberId) => string,
  labels: ExportLabels,
  modelOf?: (vote: DebateVoteRecord['votes'][number]) => string,
): string => {
  if (record.votes.length === 0 && (debate.drafts ?? []).length <= 1) return labels.noVote
  const voted = record.votes.map(
    (vote) => `- ${labels.votedFor(name(vote.voterId), name(vote.draftBy), modelOf?.(vote))}`,
  )
  const silent = debate.participants
    .map((one) => one.memberId)
    .filter((id) => !record.votes.some((vote) => vote.voterId === id))
    .map((id) =>
      record.droppedOut.includes(id)
        ? `- ${labels.droppedOutWithoutVote(name(id))}`
        : `- ${labels.didNotVote(name(id))}`,
    )
  return [...voted, ...silent].join('\n')
}

export const debateJson = (debate: Debate, nameOf: (id: MemberId) => string): string => {
  const settled = draftedResultOf(debate.result)
  return JSON.stringify(
    {
      question: debate.question,
      visibility: debate.visibility,
      status: debate.status,
      endedBecause: debate.endedBecause,
      concludedBecause: debate.concludedBecause ?? null,
      createdBy: nameOf(debate.createdBy),
      createdAt: isoOf(debate.createdAt),
      closedAt: debate.closedAt === null ? null : isoOf(debate.closedAt),
      limits: debate.limits,
      participants: debate.participants.map((one) => ({ name: nameOf(one.memberId), agent: one.agentName })),
      turns: debate.turns.map((turn) => ({
        position: turn.position,
        participant: nameOf(turn.memberId),
        agent: turn.agentName,
        model: turn.agentModel ?? null,
        at: isoOf(turn.at),
        text: turn.body,
      })),
      result:
        settled === null
          ? null
          : {
              draftedBy: nameOf(settled.draftedBy),
              model: winningDraftOf(debate, settled)?.agentModel ?? null,
              ...namedResult(settled.result, nameOf),
            },
      vote:
        debate.voteRecord == null
          ? null
          : {
              votes: debate.voteRecord.votes.map((vote) => ({
                voter: nameOf(vote.voterId),
                model: vote.agentModel ?? null,
                votedFor: nameOf(vote.draftBy),
              })),
              droppedOut: debate.voteRecord.droppedOut.map(nameOf),
            },
    },
    null,
    2,
  )
}

export const debateResultText = (
  debate: Debate,
  result: DebateResult,
  nameOf: (id: MemberId) => string,
): string =>
  [
    `From the debate room: ${PLAIN.inline(debate.question)}`,
    ...resultIn(PLAIN, exportLabelsIn(null), result, nameOf),
  ].join('\n\n')

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
  inline: (text) => escapeMarkdown(oneLine(text)).replace(/^-/, '\\-'),
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

const resultIn = (
  style: Style,
  labels: ExportLabels,
  result: DebateResult,
  nameOf: (id: MemberId) => string,
): string[] => {
  const name = (id: MemberId) => style.inline(nameOf(id))
  return [
    style.heading(2, result.kind === 'conclusion' ? labels.conclusion : labels.noConclusion),
    ...(result.kind === 'conclusion'
      ? [
          style.block(result.conclusion),
          `${style.heading(3, labels.reasons)}\n\n${result.reasons.map((reason) => `- ${style.inline(reason)}`).join('\n')}`,
          ...listSection(
            style,
            labels.changedMinds,
            (result.changedMinds ?? []).map((one) => labels.changedMind(one.turn, style.inline(one.line))),
          ),
          ...listSection(
            style,
            labels.stillOpen,
            (result.stillOpen ?? []).map((question) => style.inline(question)),
          ),
          ...listSection(style, labels.differences, (result.points ?? []).map(pointLine(style, labels))),
        ]
      : [
          style.block(result.summary),
          `${style.heading(3, labels.disagreements)}\n\n${result.points.map((point) => `- ${pointLine(style, labels)(point)}`).join('\n')}`,
        ]),
    `${style.heading(3, labels.nextSteps)}\n\n${
      result.nextSteps
        .map(
          (step) =>
            `- ${style.inline(step.step)} (${labels.step(step.owner === null ? null : name(step.owner), name(step.proposedBy))})`,
        )
        .join('\n') || labels.noNextSteps
    }`,
    `${style.heading(3, labels.contributions)}\n\n${result.contributions
      .map(
        (one) =>
          `- ${labels.contribution(name(one.memberId))}: ${style.inline(one.summary)}${one.credits.length === 0 ? '' : ` (${one.credits.map((credit) => creditText(labels, credit)).join(labels.listSeparator)})`}`,
      )
      .join('\n')}`,
  ]
}

/** A titled list, or nothing when it is empty. */
const listSection = (style: Style, title: string, lines: ReadonlyArray<string>): string[] =>
  lines.length === 0 ? [] : [`${style.heading(3, title)}\n\n${lines.map((line) => `- ${line}`).join('\n')}`]

const pointLine =
  (style: Style, labels: ExportLabels) =>
  (point: DisagreementPoint): string =>
    `${style.inline(point.point)} (${labels.categories[point.category]}): ${style.inline(point.explanation)}`

const creditText = (labels: ExportLabels, credit: NamedCredit): string => {
  const text = labels.credits[creditKindOf(credit)]
  const turn = creditTurnOf(credit)
  return turn === null ? text : labels.creditAtTurn(text, turn)
}

/** The result's sections, its heading first and then which agent drafted it with the model it stated. */
const draftedResultIn = (
  debate: Debate,
  settled: DraftedDebateResult,
  nameOf: (id: MemberId) => string,
  labels: ExportLabels,
  model: (stated: string | null | undefined) => string,
): string[] => {
  const [heading, ...sections] = resultIn(MARKDOWN, labels, settled.result, nameOf)
  const drafted = labels.draftedBy(
    MARKDOWN.inline(nameOf(settled.draftedBy)),
    model(winningDraftOf(debate, settled)?.agentModel),
  )
  return [heading!, drafted, ...sections]
}

/** The draft the result was chosen from, among this round's drafts. */
const winningDraftOf = (debate: Debate, settled: DraftedDebateResult) =>
  (debate.drafts ?? []).find((draft) => draft.draftedBy === settled.draftedBy)

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

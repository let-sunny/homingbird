import { type AsRead, type MemberId, UNKNOWN } from '@homingbird/protocol'
import { type DebateStage, type VoteRecordLine, draftsOf, voteRecordLines } from '../debates.ts'
import { formats, strings } from '../strings.ts'

/**
 * The room's result as it stands: waiting while drafts are collected and voted on, or settled. The
 * viewer's own agent is called theirs, never by the viewer's name.
 */
export const resultModel = (debate: AsRead.Debate, stage: ResultStage, people: RoomPeople): ResultModel => {
  const { nameOf, viewerId } = people
  if (debate.result === null)
    return {
      kind: 'waiting',
      text: waitingText(stage),
      collecting:
        debate.draftsCloseAt == null
          ? null
          : strings.debates.collectingUntil({ time: fullTime(debate.draftsCloseAt) }),
      voting:
        debate.votingClosesAt == null
          ? null
          : `${strings.debates.votingUntil({ time: fullTime(debate.votingClosesAt) })} ${strings.debates.votedCount({ count: (debate.votedBy ?? []).length })}`,
    }
  const lines = voteRecordLines(debate)
  return {
    kind: 'settled',
    draftedBy:
      debate.result.draftedBy === viewerId
        ? strings.debates.mine.draftedBy
        : strings.debates.draftedBy({ person: nameOf(debate.result.draftedBy) }),
    body: resultBody(debate.result.result, people),
    voteRecord:
      debate.voteRecord == null
        ? null
        : {
            none: lines.length === 0 ? strings.debates.noVote : null,
            ...tallyOf(debate, debate.voteRecord.votes, people),
            lines: lines.map((line) => ({
              kind: line.kind,
              memberId: line.memberId,
              text: voteLineText(line, people),
              model:
                line.agentModel === undefined
                  ? null
                  : line.agentModel === null
                    ? strings.authorship.modelNotStated
                    : strings.authorship.model({ model: line.agentModel }),
            })),
          },
  }
}

/** A result's words: a conclusion with its reasons, or the points of disagreement, then next steps. */
export const resultBody = (result: AsRead.DebateResult, people: RoomPeople): ResultBody => {
  const { nameOf, viewerId } = people
  const cite = people.cite ?? asPlainText
  if (result.kind === UNKNOWN) return { kind: 'unknown', text: strings.debates.unknownResult }
  const conclusion = result.kind === 'conclusion'
  return {
    kind: 'known',
    heading: conclusion ? strings.debates.conclusion : strings.debates.noConclusion,
    summary: cite(conclusion ? result.conclusion : result.summary),
    listHeading: conclusion ? strings.debates.reasons : strings.debates.disagreements,
    reasons: conclusion ? result.reasons.map(cite) : null,
    points: conclusion
      ? null
      : result.points.map((point) => ({
          category: point.category,
          point: point.point,
          categoryText: strings.debates.category[point.category],
          explanation: cite(point.explanation),
        })),
    nextSteps: {
      heading: strings.debates.nextSteps,
      none: result.nextSteps.length === 0 ? strings.debates.noNextSteps : null,
      steps: result.nextSteps.map((step) => ({
        step: cite(step.step),
        owner:
          step.owner === null
            ? null
            : step.owner === viewerId
              ? strings.debates.mine.owner
              : strings.debates.owner({ person: nameOf(step.owner) }),
        proposedBy:
          step.proposedBy === viewerId
            ? strings.debates.mine.proposedBy
            : strings.debates.proposedBy({ person: nameOf(step.proposedBy) }),
      })),
    },
    contributions: {
      heading: strings.debates.contributions,
      rows: result.contributions.map((contribution) => ({
        name: contribution.memberId === viewerId ? strings.debates.mine.agent : nameOf(contribution.memberId),
        summary: cite(contribution.summary),
        credits: contribution.credits.filter(isShownAlone).map(creditShown),
      })),
    },
  }
}

/**
 * A credit as the room shows it, with what it means on request. "Changed position" alone says nothing a
 * reader can check, so it is shown only where the room can name the turns it changed between.
 */
export const creditShown = (credit: Credit): { readonly text: string; readonly hint: string } => ({
  text: strings.debates.credit[credit],
  hint: strings.debates.creditHint[credit],
})

export const isShownAlone = (credit: Credit): boolean => credit !== 'position_changed'

export type Credit = Extract<
  AsRead.DebateResult,
  { kind: 'conclusion' }
>['contributions'][number]['credits'][number]

/** Text with the turns it cites as links into the room's turns. */
export type CitedText = ReadonlyArray<
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'turn'; readonly text: string; readonly href: string }
>

/**
 * How a room names people, by name, except the viewer, whose agent is called theirs; and how it links
 * the turns a text cites, when it shows them.
 */
export interface RoomPeople {
  readonly nameOf: (id: MemberId) => string
  readonly viewerId: MemberId
  readonly cite?: (text: string) => CitedText
}

/** The stages in which a room shows its result, settled or still to come. */
export type ResultStage = Extract<DebateStage, 'awaiting-result' | 'voting' | 'closed'>

export type ResultModel =
  | {
      readonly kind: 'waiting'
      readonly text: string | null
      readonly collecting: string | null
      readonly voting: string | null
    }
  | {
      readonly kind: 'settled'
      readonly draftedBy: string
      readonly body: ResultBody
      readonly voteRecord: {
        readonly none: string | null
        /** Each draft with its votes, once more than one draft was voted on. */
        readonly tally: ReadonlyArray<TallyLine>
        /** How a tie was settled, when the chosen draft tied with another. */
        readonly tie: string | null
        readonly lines: ReadonlyArray<VoteLine>
      } | null
    }

export interface TallyLine {
  readonly memberId: MemberId
  readonly draft: string
  readonly votes: string
  readonly chosen: boolean
}

export interface VoteLine {
  readonly kind: 'voted' | 'dropped-out' | 'silent'
  readonly memberId: MemberId
  readonly text: string
  /** The model the voter stated, beside its vote; null for no vote, or while note details are off. */
  readonly model: string | null
}

export type ResultBody =
  | { readonly kind: 'unknown'; readonly text: string }
  | {
      readonly kind: 'known'
      readonly heading: string
      readonly summary: CitedText
      readonly listHeading: string
      readonly reasons: ReadonlyArray<CitedText> | null
      readonly points: ReadonlyArray<{
        readonly category: string
        readonly point: string
        readonly categoryText: string
        readonly explanation: CitedText
      }> | null
      readonly nextSteps: {
        readonly heading: string
        readonly none: string | null
        readonly steps: ReadonlyArray<{
          readonly step: CitedText
          readonly owner: string | null
          readonly proposedBy: string
        }>
      }
      readonly contributions: {
        readonly heading: string
        readonly rows: ReadonlyArray<{
          readonly name: string
          readonly summary: CitedText
          /** Each credit's name, and what it means, shown beside it on request. */
          readonly credits: ReadonlyArray<{ readonly text: string; readonly hint: string }>
        }>
      }
    }

const tallyOf = (
  debate: AsRead.Debate,
  votes: NonNullable<AsRead.Debate['voteRecord']>['votes'],
  { nameOf, viewerId }: RoomPeople,
): { readonly tally: ReadonlyArray<TallyLine>; readonly tie: string | null } => {
  const drafts = draftsOf(debate)
  if (drafts.length < 2) return { tally: [], tie: null }
  const counted = drafts.map(({ draft, chosen }) => ({
    draft,
    chosen,
    votes: draft.votes ?? votes.filter((vote) => vote.draftBy === draft.draftedBy).length,
  }))
  const titleOf = (memberId: MemberId): string =>
    memberId === viewerId
      ? strings.debates.mine.draftOf
      : strings.debates.draftOf({ person: nameOf(memberId) })
  const chosen = counted.find((one) => one.chosen)
  const tied = chosen === undefined ? [] : counted.filter((one) => one.votes === chosen.votes)
  const earliest = Math.min(...tied.map((one) => one.draft.draftedAt))
  return {
    tally: counted.map((one) => ({
      memberId: one.draft.draftedBy,
      draft: titleOf(one.draft.draftedBy),
      votes: strings.debates.votes({ count: one.votes }),
      chosen: one.chosen,
    })),
    tie:
      chosen !== undefined && tied.length > 1 && chosen.draft.draftedAt === earliest
        ? strings.debates.tie({ count: chosen.votes, draft: titleOf(chosen.draft.draftedBy) })
        : null,
  }
}

const voteLineText = (line: VoteRecordLine, { nameOf, viewerId }: RoomPeople): string => {
  const mine = line.memberId === viewerId
  if (line.kind === 'dropped-out')
    return mine
      ? strings.debates.mine.droppedOutWithoutVote
      : strings.debates.droppedOutWithoutVote({ person: nameOf(line.memberId) })
  if (line.kind === 'silent')
    return mine
      ? strings.debates.mine.didNotVote
      : strings.debates.didNotVote({ person: nameOf(line.memberId) })
  const author = line.draftBy!
  if (mine) return strings.debates.mine.votedFor({ author: nameOf(author) })
  if (author === viewerId) return strings.debates.mine.votedForMine({ voter: nameOf(line.memberId) })
  return strings.debates.votedFor({ voter: nameOf(line.memberId), author: nameOf(author) })
}

const asPlainText = (text: string): CitedText => [{ kind: 'text', text }]

const fullTime = (timestamp: number): string => formats.full.format(new Date(timestamp))

const waitingText = (stage: ResultStage): string | null =>
  stage === 'closed'
    ? null
    : stage === 'voting'
      ? strings.debates.waitingForVotes
      : strings.debates.waitingForResult

import { type AsRead, type MemberId, UNKNOWN } from '@homingbird/protocol'
import { type DebateStage, type VoteRecordLine, voteRecordLines } from '../debates.ts'
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
  if (result.kind === UNKNOWN) return { kind: 'unknown', text: strings.debates.unknownResult }
  const conclusion = result.kind === 'conclusion'
  return {
    kind: 'known',
    heading: conclusion ? strings.debates.conclusion : strings.debates.noConclusion,
    summary: conclusion ? result.conclusion : result.summary,
    listHeading: conclusion ? strings.debates.reasons : strings.debates.disagreements,
    reasons: conclusion ? result.reasons : null,
    points: conclusion
      ? null
      : result.points.map((point) => ({
          category: point.category,
          point: point.point,
          categoryText: strings.debates.category[point.category],
          explanation: point.explanation,
        })),
    nextSteps: {
      heading: strings.debates.nextSteps,
      none: result.nextSteps.length === 0 ? strings.debates.noNextSteps : null,
      steps: result.nextSteps.map((step) => ({
        step: step.step,
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
        summary: contribution.summary,
        credits: contribution.credits.map((credit) => ({
          text: strings.debates.credit[credit],
          hint: strings.debates.creditHint[credit],
        })),
      })),
    },
  }
}

/** How a room names people: by name, except the viewer, whose agent is called theirs. */
export interface RoomPeople {
  readonly nameOf: (id: MemberId) => string
  readonly viewerId: MemberId
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
        readonly lines: ReadonlyArray<VoteLine>
      } | null
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
      readonly summary: string
      readonly listHeading: string
      readonly reasons: ReadonlyArray<string> | null
      readonly points: ReadonlyArray<{
        readonly category: string
        readonly point: string
        readonly categoryText: string
        readonly explanation: string
      }> | null
      readonly nextSteps: {
        readonly heading: string
        readonly none: string | null
        readonly steps: ReadonlyArray<{
          readonly step: string
          readonly owner: string | null
          readonly proposedBy: string
        }>
      }
      readonly contributions: {
        readonly heading: string
        readonly rows: ReadonlyArray<{
          readonly name: string
          readonly summary: string
          /** Each credit's name, and what it means, shown beside it on request. */
          readonly credits: ReadonlyArray<{ readonly text: string; readonly hint: string }>
        }>
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

const fullTime = (timestamp: number): string => formats.full.format(new Date(timestamp))

const waitingText = (stage: ResultStage): string | null =>
  stage === 'closed'
    ? null
    : stage === 'voting'
      ? strings.debates.waitingForVotes
      : strings.debates.waitingForResult

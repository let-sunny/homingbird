import { type AsRead, type MemberId, UNKNOWN } from '@homingbird/protocol'
import { type DebateStage, voteRecordLines } from '../debates.ts'
import { formats, strings } from '../strings.ts'

/** The room's result as it stands: waiting while drafts are collected and voted on, or settled. */
export const resultModel = (
  debate: AsRead.Debate,
  stage: ResultStage,
  nameOf: (id: MemberId) => string,
): ResultModel => {
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
    draftedBy: strings.debates.draftedBy({ person: nameOf(debate.result.draftedBy) }),
    body: resultBody(debate.result.result, nameOf),
    voteRecord:
      debate.voteRecord == null
        ? null
        : {
            title: strings.debates.voteRecordTitle,
            none: lines.length === 0 ? strings.debates.noVote : null,
            lines: lines.map((line) => ({
              kind: line.kind,
              memberId: line.memberId,
              text:
                line.kind === 'voted'
                  ? strings.debates.votedFor({ voter: nameOf(line.memberId), author: nameOf(line.draftBy!) })
                  : line.kind === 'dropped-out'
                    ? strings.debates.droppedOutWithoutVote({ person: nameOf(line.memberId) })
                    : strings.debates.didNotVote({ person: nameOf(line.memberId) }),
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
export const resultBody = (result: AsRead.DebateResult, nameOf: (id: MemberId) => string): ResultBody => {
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
        owner: step.owner === null ? null : strings.debates.owner({ person: nameOf(step.owner) }),
        proposedBy: strings.debates.proposedBy({ person: nameOf(step.proposedBy) }),
      })),
    },
    contributions: {
      heading: strings.debates.contributions,
      rows: result.contributions.map((contribution) => ({
        name: nameOf(contribution.memberId),
        summary: contribution.summary,
        credits: contribution.credits.map((credit) => strings.debates.credit[credit]),
      })),
    },
  }
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
        readonly title: string
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
          readonly credits: ReadonlyArray<string>
        }>
      }
    }

const fullTime = (timestamp: number): string => formats.full.format(new Date(timestamp))

const waitingText = (stage: ResultStage): string | null =>
  stage === 'closed'
    ? null
    : stage === 'voting'
      ? strings.debates.waitingForVotes
      : strings.debates.waitingForResult

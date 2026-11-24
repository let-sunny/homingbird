import { type AsRead, type MemberId, type NoteId, isKnown } from '@homingbird/protocol'
import { channelLabel } from '../channels.ts'
import { featureOn } from '../features.ts'
import { hrefFor } from '../routes.ts'
import { listOf, strings } from '../strings.ts'
import { type CorrectionPrefill, correctionPrefill } from './channel-teaching.ts'
import type { ListWait } from './start.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * What the managers of a channel decided on its agent's answers, for them alone: each answer as sent or
 * discarded, who decided and when, the question, the agent's own words beside an edit, the reason for a
 * discard and the principles it applied, with a way to teach the agent from it while teaching is on.
 */
export const channelDecisionsModel = (
  decisions: AsRead.ChannelDecisions | null,
  wait: ListWait | null,
  context: {
    readonly agent: string
    readonly members: ReadonlyMap<MemberId, AsRead.Member>
    readonly serverInfo: AsRead.ServerInfo | null
    readonly now: number
  },
): ChannelDecisionsModel => {
  if (wait !== null) return { kind: 'waiting', title: strings.channelDecisions.title, wait }
  if (decisions === null) return { kind: 'hidden' }
  const { agent } = context
  const words = { agent, channel: channelLabel(decisions.channel), days: decisions.days }
  const teaching = featureOn('teaching', context.serverInfo)
  return {
    kind: 'decisions',
    title: strings.channelDecisions.title,
    intro: strings.channelDecisions.intro(words),
    none: decisions.decisions.length === 0 ? strings.channelDecisions.none(words) : null,
    listLabel: strings.channelDecisions.listLabel({ agent }),
    rows: decisions.decisions.map((decision) =>
      decisionRow(decision, decisions.channel, { ...context, teaching }),
    ),
  }
}

export type ChannelDecisionsModel =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'waiting'; readonly title: string; readonly wait: ListWait }
  | {
      readonly kind: 'decisions'
      readonly title: string
      readonly intro: string
      readonly none: string | null
      readonly listLabel: string
      readonly rows: ReadonlyArray<DecisionRow>
    }

export interface DecisionRow {
  readonly key: NoteId
  readonly outcome: Decision['outcome']
  readonly label: string
  readonly decidedBy: string
  readonly time: TimeShown
  readonly privately: string | null
  readonly question: { readonly from: string; readonly body: string } | null
  readonly answer: { readonly label: string; readonly body: string }
  /** What the agent wrote, beside the answer a manager edited. */
  readonly original: { readonly label: string; readonly body: string } | null
  readonly reason: { readonly label: string; readonly body: string } | null
  readonly principles: string | null
  readonly open: { readonly href: string; readonly label: string }
  /** Teaching the agent from this decision, prefilled from an edit; null while teaching is off. */
  readonly teach: { readonly label: string; readonly prefill: CorrectionPrefill | null } | null
}

const decisionRow = (
  decision: Decision,
  slug: string,
  context: {
    readonly agent: string
    readonly members: ReadonlyMap<MemberId, AsRead.Member>
    readonly now: number
    readonly teaching: boolean
  },
): DecisionRow => {
  const labels = strings.channelDecisions
  const nameOf = (id: MemberId): string => context.members.get(id)?.name ?? strings.formerMember
  const discarded = decision.outcome === 'discarded'
  return {
    key: decision.noteId,
    outcome: decision.outcome,
    label: labels.outcome[decision.outcome],
    decidedBy:
      decision.decidedBy === null
        ? labels.discardedByAManager
        : labels.decidedBy[decision.outcome]({ name: nameOf(decision.decidedBy) }),
    time: timeShown(decision.decidedAt, context.now),
    privately: decision.privately ? strings.channelAgent.askedPrivately : null,
    question:
      decision.question === null
        ? null
        : {
            from: strings.channelAgent.questionFrom({ name: nameOf(decision.question.authorId) }),
            body: decision.question.body,
          },
    answer: { label: discarded ? labels.answerDiscarded : labels.answerSent, body: decision.answer },
    original:
      decision.agentAnswer === null
        ? null
        : { label: labels.agentWrote({ agent: context.agent }), body: decision.agentAnswer },
    reason: decision.reason === null ? null : { label: labels.reason, body: decision.reason },
    principles:
      decision.principles.length === 0
        ? null
        : labels.principles({ principles: listOf(decision.principles.map((each) => each.topic)) }),
    open: {
      href: hrefFor({
        name: 'conversation',
        id: decision.conversationId,
        draft: null,
        ...noteShown(decision),
      }),
      label: labels.open,
    },
    teach: context.teaching && isKnown(decision.outcome) ? teachFrom(decision, slug, context.agent) : null,
  }
}

/** A sent answer is shown in its conversation; a discarded one is not there, so its question is. */
const noteShown = (decision: Decision): { readonly note?: string } =>
  decision.outcome !== 'discarded'
    ? { note: decision.noteId }
    : decision.question === null
      ? {}
      : { note: decision.question.id }

const teachFrom = (decision: Decision, slug: string, agent: string): NonNullable<DecisionRow['teach']> => {
  if (decision.outcome === 'discarded') {
    const prefill = correctionPrefill(decision.answer, { kind: 'discard' }, slug)
    return { label: prefill.label, prefill }
  }
  if (decision.agentAnswer !== null) {
    const prefill = correctionPrefill(decision.agentAnswer, { kind: 'edit', body: decision.answer }, slug)
    return { label: prefill.label, prefill }
  }
  return { label: strings.channelTeach.add({ agent }), prefill: null }
}

type Decision = AsRead.ChannelDecisions['decisions'][number]

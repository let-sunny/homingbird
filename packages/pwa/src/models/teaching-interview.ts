import {
  ANSWER_TEXT_MAX,
  type AsRead,
  PRINCIPLE_TEXT_MAX,
  PRINCIPLE_TOPIC_MAX,
  type ProposalId,
  TEACHING_DOCUMENT_MAX,
  principleAdvice,
  principleProblem,
} from '@homingbird/protocol'
import { problemText } from '../principles.ts'
import { strings } from '../strings.ts'
import { placeName } from './places.ts'
import type { ListWait } from './start.ts'

/**
 * "Teach by chatting": how to start a chat with the person's own agent, the pasted document, and the
 * proposals it made, as cards in two groups, each with a way to save them all. The web client has no
 * model; it only shows what the agent proposed and saves what the person chooses.
 */
export const interviewModel = (
  interview: AsRead.TeachingInterview | null,
  wait: ListWait,
): InterviewModel => {
  if (interview === null) return { kind: 'waiting', wait }
  const chat = interview.proposals.filter((proposal) => !isFromRewrite(proposal))
  const rewrites = interview.proposals.filter(isFromRewrite)
  const groups = [
    group('chat', strings.teach.chat.proposalsTitle, null, chat),
    group('rewrites', strings.teach.chat.rewritesTitle, strings.teach.chat.rewritesIntro, rewrites),
  ].filter((each): each is ProposalGroup => each !== null)
  return {
    kind: 'shown',
    title: strings.teach.chat.title,
    intro: strings.teach.chat.intro,
    steps: [
      strings.teach.chat.steps.paste,
      strings.teach.chat.steps.start({ command: strings.teach.chat.command }),
      strings.teach.chat.steps.answer,
    ],
    noModel: strings.teach.chat.noModel,
    document: {
      label: strings.teach.chat.documentLabel,
      hint: strings.teach.chat.documentHint({ max: TEACHING_DOCUMENT_MAX }),
      value: interview.document ?? '',
      maxLength: TEACHING_DOCUMENT_MAX,
      save: strings.teach.chat.documentSave,
      remove: interview.document === null ? null : strings.teach.chat.documentRemove,
    },
    groups,
    empty: groups.length === 0 ? strings.teach.chat.empty : null,
    waiting: strings.teach.chat.waiting({ count: interview.proposals.length, limit: interview.limit }),
  }
}

/** What saving a card with the person's changes sends, or why it cannot be saved yet. */
export const proposalChange = (
  card: ProposalCard,
  values: { readonly topic: string; readonly rule: string },
): { readonly problem: string } | { readonly change: { readonly topic: string; readonly rule: string } } => {
  const topic = values.topic.trim()
  const rule = values.rule.trim()
  const problem = problemText(
    principleProblem({
      kind: card.proposal.kind === 'answer' ? 'answer' : 'rule',
      topic,
      rule,
      source: card.proposal.source,
    }),
  )
  if (problem !== null) return { problem }
  if (topic === '') return { problem: strings.teach.chat.topicEmpty }
  return { change: { topic, rule } }
}

/** The ids a "Save all" sends, in the order shown. */
export const idsOf = (cards: ReadonlyArray<ProposalCard>): ProposalId[] =>
  cards.map((card) => card.proposal.id)

export type InterviewModel =
  | { readonly kind: 'waiting'; readonly wait: ListWait }
  | {
      readonly kind: 'shown'
      readonly title: string
      readonly intro: string
      readonly steps: ReadonlyArray<string>
      readonly noModel: string
      readonly document: {
        readonly label: string
        readonly hint: string
        readonly value: string
        readonly maxLength: number
        readonly save: string
        readonly remove: string | null
      }
      readonly groups: ReadonlyArray<ProposalGroup>
      readonly empty: string | null
      readonly waiting: string
    }

export interface ProposalGroup {
  readonly key: 'chat' | 'rewrites'
  readonly title: string
  readonly intro: string | null
  readonly cards: ReadonlyArray<ProposalCard>
  readonly saveAll: string
}

export interface ProposalCard {
  readonly proposal: AsRead.PrincipleProposal
  readonly kindBadge: string
  readonly details: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
  readonly fields: ReadonlyArray<{
    readonly name: 'topic' | 'rule'
    readonly label: string
    readonly value: string
    readonly maxLength: number
  }>
  readonly labels: {
    readonly save: string
    readonly edit: string
    readonly discard: string
    readonly saveEdited: string
  }
}

const group = (
  key: ProposalGroup['key'],
  title: string,
  intro: string | null,
  proposals: ReadonlyArray<AsRead.PrincipleProposal>,
): ProposalGroup | null =>
  proposals.length === 0
    ? null
    : {
        key,
        title,
        intro,
        cards: proposals.map(cardOf),
        saveAll: strings.teach.chat.saveAll({ count: proposals.length }),
      }

const isFromRewrite = (proposal: AsRead.PrincipleProposal): boolean =>
  proposal.origin === 'edit' || proposal.origin === 'discard'

const cardOf = (proposal: AsRead.PrincipleProposal): ProposalCard => ({
  proposal,
  kindBadge: strings.teach.kindBadge[proposal.kind],
  details: [
    ...(proposal.question === null ? [] : [strings.teach.chat.asked({ question: proposal.question })]),
    ...(proposal.origin === 'edit' ? [strings.teach.chat.fromEdit] : []),
    ...(proposal.origin === 'discard' ? [strings.teach.chat.fromDiscard] : []),
    proposal.place === null ? strings.teach.anywhere : placeName(proposal.place),
  ],
  warnings: principleAdvice(proposal)
    .filter((advice) => advice !== 'vague')
    .map((advice) => strings.teach.advice[advice]),
  fields: [
    { name: 'topic', label: strings.teach.topic, value: proposal.topic, maxLength: PRINCIPLE_TOPIC_MAX },
    {
      name: 'rule',
      label: proposal.kind === 'answer' ? strings.teach.answer : strings.teach.rule,
      value: proposal.rule,
      maxLength: proposal.kind === 'answer' ? ANSWER_TEXT_MAX : PRINCIPLE_TEXT_MAX,
    },
  ],
  labels: {
    save: strings.teach.chat.save,
    edit: strings.teach.chat.edit,
    discard: strings.teach.chat.discard,
    saveEdited: strings.teach.chat.saveEdited,
  },
})

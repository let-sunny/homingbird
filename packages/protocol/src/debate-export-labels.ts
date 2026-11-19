import type { ClaimedCredit, DisagreementCategory } from './debate-result.ts'
import type { DebateEnding, DebateStatus, DebateVisibility } from './debates.ts'
import { DEFAULT_LOCALE, type Locale } from './model.ts'

/** The headings and labels of an export in the exporting person's language; English is the fallback. */
export const exportLabelsIn = (locale: Locale | null): ExportLabels => EXPORT_LABELS[locale ?? DEFAULT_LOCALE]

export interface ExportLabels {
  readonly title: (question: string) => string
  readonly visibility: string
  readonly visibilities: Readonly<Record<DebateVisibility, string>>
  readonly status: string
  readonly statuses: Readonly<Record<DebateStatus, string>>
  readonly endings: Readonly<Record<DebateEnding, string>>
  readonly created: (at: string, person: string) => string
  readonly limits: (limits: {
    readonly perAgent: number
    readonly total: number
    readonly minutes: number
    readonly characters: number
  }) => string
  readonly participants: string
  readonly participantAgent: (person: string, agent: string) => string
  readonly none: string
  readonly turns: string
  readonly noTurns: string
  readonly turnHeading: (position: number, person: string, agent: string, at: string) => string
  readonly result: string
  readonly noResult: string
  readonly conclusion: string
  readonly noConclusion: string
  readonly reasons: string
  readonly disagreements: string
  readonly categories: Readonly<Record<DisagreementCategory, string>>
  readonly nextSteps: string
  readonly noNextSteps: string
  readonly step: (owner: string | null, proposer: string) => string
  readonly contributions: string
  readonly contribution: (person: string) => string
  readonly credits: Readonly<Record<ClaimedCredit, string>>
  readonly listSeparator: string
  readonly vote: string
  readonly votedFor: (voter: string, author: string) => string
  readonly droppedOutWithoutVote: (person: string) => string
  readonly didNotVote: (person: string) => string
  readonly noVote: string
}

const en: ExportLabels = {
  title: (question) => `Debate room: ${question}`,
  visibility: 'Visibility',
  visibilities: { open: 'open', private: 'private' },
  status: 'Status',
  statuses: { open: 'open', concluding: 'concluding', closed: 'closed', ended: 'ended' },
  endings: {
    too_few_agents: 'too few agents',
    no_turns: 'no turns were taken',
    no_result: 'no result was settled in time',
    one_agent_left: 'the other agents dropped out of the debate and one agent was left',
    no_agent_left: 'every agent dropped out of the debate',
  },
  created: (at, person) => `Created: ${at} by ${person}`,
  limits: ({ perAgent, total, minutes, characters }) =>
    `Limits: ${perAgent} turns per agent, ${total} in total, ${minutes} minutes, ${characters} characters per turn`,
  participants: 'Participants',
  participantAgent: (person, agent) => `${person} (agent: ${agent})`,
  none: 'none',
  turns: 'Turns',
  noTurns: 'No turns were taken.',
  turnHeading: (position, person, agent, at) => `${position}. ${person}’s agent (${agent}), ${at}`,
  result: 'Result',
  noResult: 'No result was drafted.',
  conclusion: 'Result: conclusion',
  noConclusion: 'Result: no conclusion',
  reasons: 'Reasons',
  disagreements: 'Where they disagreed',
  categories: {
    information: 'information',
    assumptions: 'assumptions',
    goals: 'goals',
    open_question: 'open question',
  },
  nextSteps: 'Next steps',
  noNextSteps: 'None proposed.',
  step: (owner, proposer) => `owner: ${owner ?? 'not named'}; proposed by ${proposer}’s agent`,
  contributions: 'Contributions',
  contribution: (person) => `${person}’s agent`,
  credits: {
    gap_filled: 'filled a gap',
    disagreement_separated: 'separated a disagreement',
    position_changed: 'changed position on better evidence',
  },
  listSeparator: ', ',
  vote: 'Vote',
  votedFor: (voter, author) => `${voter}’s agent voted for ${author}’s draft`,
  droppedOutWithoutVote: (person) => `${person}’s agent dropped out of the debate and did not vote`,
  didNotVote: (person) => `${person}’s agent did not vote in time`,
  noVote: 'No vote was held: the result was the only draft.',
}

const ko: ExportLabels = {
  title: (question) => `토론방: ${question}`,
  visibility: '공개 범위',
  visibilities: { open: '공개', private: '비공개' },
  status: '상태',
  statuses: { open: '진행 중', concluding: '결과 정리 중', closed: '닫힘', ended: '결과 없이 끝남' },
  endings: {
    too_few_agents: '참여한 에이전트가 너무 적었어요',
    no_turns: '차례를 가진 에이전트가 없었어요',
    no_result: '정해진 시간 안에 정해진 결과가 없었어요',
    one_agent_left: '다른 에이전트들이 토론에서 이탈해 에이전트 하나만 남았어요',
    no_agent_left: '모든 에이전트가 토론에서 이탈했어요',
  },
  created: (at, person) => `만든 때: ${at}, 만든 사람: ${person}`,
  limits: ({ perAgent, total, minutes, characters }) =>
    `제한: 에이전트마다 ${perAgent}번, 모두 ${total}번, ${minutes}분, 차례마다 ${characters}자`,
  participants: '참여자',
  participantAgent: (person, agent) => `${person} (에이전트: ${agent})`,
  none: '없음',
  turns: '차례',
  noTurns: '차례가 없었어요.',
  turnHeading: (position, person, agent, at) => `${position}. ${person} 님의 에이전트 (${agent}), ${at}`,
  result: '결과',
  noResult: '작성된 결과가 없어요.',
  conclusion: '결과: 결론',
  noConclusion: '결과: 결론 없음',
  reasons: '이유',
  disagreements: '의견이 갈린 곳',
  categories: {
    information: '정보',
    assumptions: '가정',
    goals: '목표',
    open_question: '열린 질문',
  },
  nextSteps: '다음 단계',
  noNextSteps: '제안된 단계가 없어요.',
  step: (owner, proposer) => `담당: ${owner ?? '정하지 않음'}; 제안: ${proposer} 님의 에이전트`,
  contributions: '기여',
  contribution: (person) => `${person} 님의 에이전트`,
  credits: {
    gap_filled: '빠진 정보를 채웠어요',
    disagreement_separated: '의견 차이를 나눠 정리했어요',
    position_changed: '더 나은 근거로 입장을 바꿨어요',
  },
  listSeparator: ', ',
  vote: '투표',
  votedFor: (voter, author) => `${voter} 님의 에이전트가 ${author} 님의 초안에 투표했어요`,
  droppedOutWithoutVote: (person) => `${person} 님의 에이전트는 토론에서 이탈해 투표하지 않았어요`,
  didNotVote: (person) => `${person} 님의 에이전트는 시간 안에 투표하지 않았어요`,
  noVote: '초안이 하나뿐이라 투표하지 않았어요.',
}

const EXPORT_LABELS: Readonly<Record<Locale, ExportLabels>> = { en, ko }

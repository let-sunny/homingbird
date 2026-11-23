import {
  type AsRead,
  DEBATE_BRIEF_MAX,
  DEBATE_QUESTION_MAX,
  type MemberId,
  SHORT_DEBATE_LIMITS,
  SUGGESTED_MEMBERS_MAX,
} from '@homingbird/protocol'
import { listOf, strings } from '../strings.ts'

/**
 * An agent's suggestion to talk a note over before answering, as a card: why, the question and the
 * colleagues it would ask, each still the person's to change. Nothing exists until they open the room.
 */
export const suggestionCardModel = (input: {
  readonly suggestion: AsRead.DebateSuggestion
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
}): SuggestionCard => {
  const { suggestion } = input
  const names = suggestion.memberIds.flatMap((id) => {
    const name = input.members.get(id)?.name
    return name === undefined ? [] : [name]
  })
  return {
    suggestion,
    heading:
      names.length === 0
        ? strings.debateSuggestion.headingAlone({ agent: suggestion.agentName })
        : strings.debateSuggestion.heading({ agent: suggestion.agentName, people: listOf(names) }),
    reason: { label: strings.debateSuggestion.reasonLabel, text: suggestion.reason },
    question: {
      label: strings.debateSuggestion.questionLabel,
      value: suggestion.question,
      maxLength: DEBATE_QUESTION_MAX,
    },
    people: {
      label: strings.debateSuggestion.peopleLabel,
      placeholder: strings.debateSuggestion.peoplePlaceholder,
      chosen: suggestion.memberIds,
      limit: SUGGESTED_MEMBERS_MAX,
    },
    brief: {
      label: strings.debateSuggestion.briefLabel,
      hint: strings.debateSuggestion.briefHint,
      maxLength: DEBATE_BRIEF_MAX,
    },
    limits: strings.debateSuggestion.limits({ minutes: SHORT_DEBATE_LIMITS.minutes }),
    labels: { open: strings.debateSuggestion.open, dismiss: strings.debateSuggestion.dismiss },
  }
}

/** What opening the room sends, from what the person left or changed, or why it cannot be opened yet. */
export const suggestionAcceptance = (typed: {
  readonly question: string
  readonly memberIds: ReadonlyArray<MemberId>
  readonly brief: string
}): { readonly problem: string } | { readonly acceptance: SuggestionChange } => {
  const question = typed.question.trim()
  const brief = typed.brief.trim()
  if (question === '') return { problem: strings.debateSuggestion.questionEmpty }
  if (question.length > DEBATE_QUESTION_MAX)
    return { problem: strings.debateSuggestion.questionTooLong({ max: DEBATE_QUESTION_MAX }) }
  if (typed.memberIds.length === 0) return { problem: strings.debateSuggestion.peopleEmpty }
  if (typed.memberIds.length > SUGGESTED_MEMBERS_MAX)
    return { problem: strings.debateSuggestion.peopleTooMany({ max: SUGGESTED_MEMBERS_MAX }) }
  return {
    acceptance: { question, memberIds: [...typed.memberIds], ...(brief !== '' && { brief }) },
  }
}

export interface SuggestionChange {
  readonly question: string
  readonly memberIds: MemberId[]
  readonly brief?: string
}

export interface SuggestionCard {
  readonly suggestion: AsRead.DebateSuggestion
  readonly heading: string
  readonly reason: { readonly label: string; readonly text: string }
  readonly question: { readonly label: string; readonly value: string; readonly maxLength: number }
  readonly people: {
    readonly label: string
    readonly placeholder: string
    readonly chosen: ReadonlyArray<MemberId>
    readonly limit: number
  }
  readonly brief: { readonly label: string; readonly hint: string; readonly maxLength: number }
  readonly limits: string
  readonly labels: { readonly open: string; readonly dismiss: string }
}

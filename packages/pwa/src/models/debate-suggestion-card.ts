import {
  type AsRead,
  DEBATE_BRIEF_MAX,
  DEBATE_QUESTION_MAX,
  type MemberId,
  SHORT_DEBATE_LIMITS,
  SUGGESTED_MEMBERS_MAX,
} from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { listOf, strings } from '../strings.ts'

/**
 * An agent's suggestion to talk a note over before answering, as a card: why, the question and the
 * colleagues it would ask, each still the person's to change, whose agents are not awake, and, when fewer
 * than two agents are awake to talk, that a group note may answer sooner. Nothing exists until they open
 * the flock.
 */
export const suggestionCardModel = (input: {
  readonly suggestion: AsRead.DebateSuggestion
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly viewerId: MemberId
}): SuggestionCard => {
  const { suggestion } = input
  const namesOf = (ids: ReadonlyArray<MemberId>): string[] =>
    ids.flatMap((id) => {
      const name = input.members.get(id)?.name
      return name === undefined ? [] : [name]
    })
  const names = namesOf(suggestion.memberIds)
  const isAwake = (id: MemberId): boolean =>
    input.directory.find((entry) => entry.member.id === id)?.presence.agentOnline ?? false
  const asleepNames = namesOf(suggestion.memberIds.filter((id) => !isAwake(id)))
  const mineAwake = input.directory.some((entry) => entry.member.id === input.viewerId)
    ? isAwake(input.viewerId)
    : true
  const awake = suggestion.memberIds.filter(isAwake).length + (mineAwake ? 1 : 0)
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
      chosen: suggestion.memberIds.filter((id) => id !== suggestion.askerId),
      limit: SUGGESTED_MEMBERS_MAX,
    },
    brief: {
      label: strings.debateSuggestion.briefLabel,
      hint: strings.debateSuggestion.briefHint,
      maxLength: DEBATE_BRIEF_MAX,
    },
    limits: strings.debateSuggestion.limits({ minutes: SHORT_DEBATE_LIMITS.minutes }),
    notAwake:
      asleepNames.length === 0 ? null : strings.debateSuggestion.notAwake({ people: listOf(asleepNames) }),
    askInNote:
      awake >= 2
        ? null
        : {
            text: strings.debateSuggestion.askInNote,
            label: strings.debateSuggestion.askInNoteLink,
            href: hrefFor({ name: 'new', to: suggestion.memberIds }),
          },
    labels: { open: strings.debateSuggestion.open, dismiss: strings.debateSuggestion.dismiss },
  }
}

/** What opening the flock sends, from what the person left or changed, or why it cannot be opened yet. */
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
  /** The colleagues whose agents are not awake now, who would take no turn until they are. */
  readonly notAwake: string | null
  /** Fewer than two agents awake to talk: a group note to the same colleagues may answer sooner. */
  readonly askInNote: { readonly text: string; readonly label: string; readonly href: string } | null
  readonly labels: { readonly open: string; readonly dismiss: string }
}

import { Schema as S } from '@homingbird/kernel'
import type * as AsRead from './as-read.ts'
import { ChannelDrafting } from './channel-drafting.ts'
import { UNKNOWN } from './compatibility.ts'
import { DebateCredit } from './debate-result.ts'
import { ConversationId, NoteId, Timestamp } from './ids.ts'
import { PlaceName } from './insights.ts'
import { PublicText } from './model.ts'
import { PrincipleSource } from './principle-source.ts'

/** The titles a basis says were applied, from its "Principles applied:" line. */
export const appliedTitlesIn = (basis: string | null | undefined): string[] => {
  const text = basis ?? ''
  const start = text.toLowerCase().lastIndexOf(APPLIED_PREFIX.toLowerCase())
  if (start === -1) return []
  return text
    .slice(start + APPLIED_PREFIX.length)
    .split('\n')[0]!
    .split(';')
    .map((title) => title.trim().replace(/[.。]$/, ''))
    .filter((title) => title !== '')
}

/** Compares without case, also when the agent copied "Title: rule" instead of the title alone. */
export const isSameTitle = (stated: string, title: string): boolean => {
  const a = stated.trim().toLowerCase()
  const b = title.trim().toLowerCase()
  return a === b || a.startsWith(`${b}:`)
}

export type PrincipleAdvice = 'forbidden' | 'stored_answer' | 'vague'

/** What the save dialog warns about. Warnings only: the person decides, and may switch a rule to an answer. */
export const principleAdvice = (draft: {
  readonly kind?: AsRead.Principle['kind'] | undefined
  readonly topic: string
  readonly rule: string
}): PrincipleAdvice[] => {
  const rule = draft.rule.trim()
  const methodical = METHOD.test(rule)
  if (draft.kind === 'answer') return isLikelyForbidden(draft) ? ['forbidden'] : []
  return [
    ...(isLikelyForbidden(draft) ? (['forbidden'] as const) : []),
    ...(!methodical && isStatement(rule) ? (['stored_answer'] as const) : []),
    ...(!methodical && (VAGUE.test(rule) || rule.split(/\s+/).filter(Boolean).length < 4)
      ? (['vague'] as const)
      : []),
  ]
}

/** A hint, by wording only, that a principle asks for something no agent may do; rules 1 and 3 are the guard. */
export const isLikelyForbidden = (principle: { readonly topic: string; readonly rule: string }): boolean =>
  FORBIDDEN_HINT.test(`${principle.topic} ${principle.rule}`)

/** Why an item cannot be saved as it is, checked by the web client and again by the server. */
export const principleProblem = (item: {
  readonly kind: PrincipleKind
  readonly topic: string
  readonly rule: string
  readonly source: string | null
}): PrincipleProblem | null => {
  const rule = item.rule.trim()
  const tooLong = item.topic.trim().length + rule.length > PRINCIPLE_TEXT_MAX
  if (item.kind === 'answer') {
    if (rule === '' && item.source === null) return 'answer_empty'
    return tooLong ? 'answer_too_long' : null
  }
  if (rule === '') return 'rule_empty'
  return tooLong ? 'rule_too_long' : null
}

export type PrincipleProblem = 'answer_empty' | 'answer_too_long' | 'rule_empty' | 'rule_too_long'
export type PublicTextProblem = 'public_empty' | 'public_repeats' | 'public_names_channel'

/** The server's English wording of each problem; the web client words them in the person's language. */
export const problemMessage = (problem: PrincipleProblem | PublicTextProblem): string =>
  ({
    answer_empty: 'An answer needs its text or a source to take it from.',
    answer_too_long: `An answer may have at most ${ANSWER_TEXT_MAX} characters, title and text together; link longer material as its source.`,
    rule_empty: 'A rule needs to say how to answer.',
    rule_too_long: `A principle may have at most ${PRINCIPLE_TEXT_MAX} characters, title and rule together.`,
    public_empty: 'Write a sentence for your colleagues first.',
    public_repeats:
      'Write the public sentence in your own words; it may not repeat the private text or its source.',
    public_names_channel: 'Leave the channel’s name out of the public sentence.',
  })[problem]

/**
 * Why a public sentence cannot be shown: it must be written for colleagues. It may not repeat a run of
 * the private text's words (four, or all of a text of two or three), name its source with or without
 * the scheme, or name the channel the principle belongs to.
 */
export const publicTextProblem = (
  publicText: string,
  item: { readonly rule: string; readonly source: string | null; readonly place?: string | null },
): PublicTextProblem | null => {
  const shown = wordsOf(publicText)
  if (shown.length === 0) return 'public_empty'
  const rule = wordsOf(item.rule)
  const repeated = rule.length >= 2 && sharedRun(shown, rule) >= Math.min(REPEATED_WORDS, rule.length)
  if (repeated || (item.source !== null && namesSource(publicText, item.source))) return 'public_repeats'
  const place = wordsOf(item.place ?? '')
  if (place.length > 0 && sharedRun(shown, place) === place.length) return 'public_names_channel'
  return null
}

export const PRINCIPLE_TOPIC_MAX = 80
export const PRINCIPLE_TEXT_MAX = 300
/** The same cap as a rule; longer material goes through a source. */
export const ANSWER_TEXT_MAX = PRINCIPLE_TEXT_MAX
/** What a stored answer may hold when read; a save or an edit must fit `ANSWER_TEXT_MAX`. */
export const STORED_RULE_MAX = 600
export const PRINCIPLES_PER_PERSON = 50
export const APPLIED_PREFIX = 'Principles applied:'

export const PrincipleTopic = S.refine<string>(
  'principle-topic',
  (text) => text.trim().length > 0 && !/[;:\n]/.test(text),
  'expected a short title without line breaks, colons or semicolons',
)(S.string({ minLength: 1, maxLength: PRINCIPLE_TOPIC_MAX }))

export const PrincipleRule = S.refine<string>(
  'principle-rule',
  (text) => !text.includes('\n'),
  'expected one line',
)(S.string({ maxLength: STORED_RULE_MAX }))

export const PrincipleKind = S.tolerant(S.literal('rule', 'answer'), UNKNOWN)
export type PrincipleKind = S.Infer<typeof PrincipleKind>

export const PrincipleId = S.brand<'PrincipleId'>()(
  S.string({ pattern: /^prin_[0-9a-z]{12,}$/, maxLength: 45 }),
)
export type PrincipleId = S.Infer<typeof PrincipleId>

export const PrincipleOrigin = S.tolerant(S.literal('manual', 'edit', 'discard'), UNKNOWN)
export type PrincipleOrigin = S.Infer<typeof PrincipleOrigin>

export const PrincipleCounts = S.struct({
  applied: S.int({ min: 0 }),
  sentAsWritten: S.int({ min: 0 }),
  edited: S.int({ min: 0 }),
  discarded: S.int({ min: 0 }),
  missed: S.int({ min: 0 }),
})
export type PrincipleCounts = S.Infer<typeof PrincipleCounts>

/** A rule or an answer a person saved for a kind of question. Private to that person but for its public sentence. */
export const Principle = S.struct({
  id: PrincipleId,
  kind: PrincipleKind,
  topic: PrincipleTopic,
  rule: PrincipleRule,
  source: S.nullable(PrincipleSource),
  place: PlaceName,
  enabled: S.boolean,
  origin: PrincipleOrigin,
  position: S.int({ min: 0 }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  lastAppliedAt: S.nullable(Timestamp),
  publicText: S.nullable(PublicText),
  counts: S.nullable(PrincipleCounts),
})
export type Principle = S.Infer<typeof Principle>

export const DraftingPrinciple = S.struct({
  kind: PrincipleKind,
  topic: PrincipleTopic,
  rule: PrincipleRule,
  source: S.nullable(PrincipleSource),
})
export type DraftingPrinciple = S.Infer<typeof DraftingPrinciple>

export const DraftingPrinciples = S.struct({
  principles: S.array(DraftingPrinciple),
  leftOut: S.int({ min: 0 }),
  ignored: S.array(S.string({ maxLength: PRINCIPLE_TOPIC_MAX })),
  ignoredLeftOut: S.int({ min: 0 }),
  channel: S.optional(ChannelDrafting),
})
export type DraftingPrinciples = S.Infer<typeof DraftingPrinciples>

export const OfferKind = S.tolerant(S.literal('edit', 'discard'), UNKNOWN)
export type OfferKind = S.Infer<typeof OfferKind>

/** A chance to teach, offered after a substantial edit or a discard. It is never part of any instruction. */
export const PrincipleOffer = S.struct({
  id: S.string({ pattern: /^offer_[0-9a-z]{12,}$/, maxLength: 46 }),
  kind: OfferKind,
  noteId: NoteId,
  conversationId: ConversationId,
  place: PlaceName,
  suggestion: S.nullable(
    S.struct({
      added: S.nullable(S.string({ maxLength: PRINCIPLE_TEXT_MAX })),
      removed: S.nullable(S.string({ maxLength: PRINCIPLE_TEXT_MAX })),
    }),
  ),
  createdAt: Timestamp,
})
export type PrincipleOffer = S.Infer<typeof PrincipleOffer>

export const Achievement = S.tolerant(
  S.literal(
    'first_principle',
    'discard_taught',
    'ten_applications',
    'careful_week',
    'debate_conclusion',
    'debate_gap_filled',
    'debate_disagreement_separated',
    'debate_position_changed',
    'debate_next_step_accepted',
  ),
  UNKNOWN,
)
export type Achievement = S.Infer<typeof Achievement>

/** A place the agent drafts in: what applies there (an any-channel principle everywhere), held up, and its open offers. */
export const RoutePoint = S.struct({
  place: PlaceName,
  drafted: S.int({ min: 0 }),
  principles: S.int({ min: 0 }),
  heldUp: S.int({ min: 0 }),
  chances: S.int({ min: 0 }),
})
export type RoutePoint = S.Infer<typeof RoutePoint>

export const MyPrinciples = S.struct({
  principles: S.array(Principle),
  offers: S.array(PrincipleOffer),
  routes: S.array(RoutePoint),
  achievements: S.array(Achievement),
  /** The kinds of credit approved debate results gave this person's agent, each once: never a count. */
  debateCredits: S.optional(S.array(DebateCredit, { maxItems: 5 })),
  limit: S.int({ min: 1 }),
})
export type MyPrinciples = S.Infer<typeof MyPrinciples>

const REPEATED_WORDS = 4

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')

/** The longest run of consecutive words the two share. */
const sharedRun = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): number => {
  let longest = 0
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      let length = 0
      while (i + length < a.length && j + length < b.length && a[i + length] === b[j + length]) length++
      longest = Math.max(longest, length)
    }
  return longest
}

/** Whether a text names a source, in any case and with or without its scheme or a closing slash. */
const namesSource = (text: string, source: string): boolean => {
  const address = source
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
  return text.toLowerCase().includes(address)
}

const METHOD =
  /\b(check|look|ask|use|give|say|point|refer|include|mention|find|link|explain|confirm|tell|answer|search|read|cite|add|name|state|quote|follow|send them|suggest|offer|leave|skip|copy|write)\b/i

const isStatement = (rule: string): boolean =>
  /\d/.test(rule) || (STATEMENT.test(rule) && !CONDITION.test(rule) && !VAGUE.test(rule))

const STATEMENT = /\b(is|are|was|were|lives|sits|means)\b|(입니다|이에요|예요|이다|있습니다|있어요)[.。]?$/i

const CONDITION = /\b(when|if|unless|whether|while|until)\b/i

const VAGUE =
  /^(be|keep it|sound|stay)\b|\b(concise|polite|nice|friendly|helpful|clear|better|careful|professional)\b\.?$/i

const FORBIDDEN_HINT = new RegExp(
  [
    String.raw`\bapprove (?:the |this |my |your |every |all )?(?:drafts?|notes?|repl(?:y|ies)|it|them)\b`,
    String.raw`\bauto-?send`,
    String.raw`\bsend (?:it|this|them|the (?:draft|note|reply)|drafts|notes|replies) (?:yourself|automatically|without)`,
    String.raw`\bdiscard (?:the |this |my |a |any )?(?:drafts?|notes?|repl(?:y|ies))\b`,
    String.raw`\b(?:add|remove|change|accept|edit|delete) (?:a |the |my )?contacts?\b`,
    String.raw`\b(?:block|unblock) (?:them|people|someone|members?|colleagues?|senders?)\b`,
    String.raw`\bcredentials?\b`,
    String.raw`\b(?:access|auth|api) (?:tokens?|keys?)\b`,
    String.raw`\bpasswords?\b`,
    String.raw`\b(?:save|change|set|reset) (?:my |a |the )?character\b`,
  ].join('|'),
  'i',
)

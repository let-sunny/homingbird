import {
  ANSWER_TEXT_MAX,
  type AsRead,
  type NoteId,
  PRINCIPLE_TEXT_MAX,
  PRINCIPLE_TOPIC_MAX,
  type PrincipleKind,
  isKnown,
  principleAdvice,
  principleProblem,
  publicTextProblem,
} from '@homingbird/protocol'
import {
  appliedClaims,
  countsShown,
  needsConfirmation,
  offersIn,
  problemText,
  sourceHost,
  suggestionText,
} from '../principles.ts'
import { percentOf, strings } from '../strings.ts'
import { placeName } from './places.ts'

/** "What I have taught it": the principles in the person's order, chances to teach, and milestones. */
export const taughtModel = (taught: AsRead.MyPrinciples | 'failed' | null): TaughtModel => {
  if (taught === null) return { kind: 'loading' }
  if (taught === 'failed') return { kind: 'failed', text: strings.trust.loadFailed }
  const milestones = taught.achievements.filter(isKnown).map((each) => strings.teach.achievements[each])
  return {
    kind: 'taught',
    intro: strings.teach.intro,
    limit: strings.teach.limit({ count: taught.principles.length, limit: taught.limit }),
    chances: taught.offers.map(chanceModel),
    empty:
      taught.principles.length === 0 ? { title: strings.teach.empty, hint: strings.teach.emptyHint } : null,
    principles: taught.principles.map(principleRow),
    milestones:
      milestones.length === 0 ? null : { title: strings.teach.achievementsTitle, items: milestones },
    footnotes: [strings.teach.privacy, strings.teach.audit],
  }
}

/** The chances to teach that came from one conversation, shown there right after the decision. */
export const chancesHere = (
  taught: AsRead.MyPrinciples | 'failed' | null,
  teachingOn: boolean,
  conversationId: string,
): ReadonlyArray<ChanceModel> =>
  taught === null || taught === 'failed' || !teachingOn
    ? []
    : offersIn(taught.offers, conversationId).map(chanceModel)

/**
 * On a draft card: what the agent says it applied, in the order its basis names them, each matched
 * principle with a way to say it was wrong here.
 */
export const appliedModel = (
  draft: Pick<AsRead.Note, 'id' | 'basis'>,
  taught: AsRead.MyPrinciples | 'failed' | null,
  teachingOn: boolean,
): ReadonlyArray<AppliedMarker> =>
  taught === null || taught === 'failed' || !teachingOn
    ? []
    : appliedClaims(draft.basis, taught.principles).map((claim) => ({
        text: strings.teach.applied({ title: claim.title }),
        principleId: claim.principle?.id ?? null,
        noteId: draft.id,
      }))

/** Whether a draft card names the applied principles itself, rather than leaving them in its basis. */
export const showsAppliedMarkers = (
  taught: AsRead.MyPrinciples | 'failed' | null,
  teachingOn: boolean,
): boolean => taught !== null && taught !== 'failed' && teachingOn

/** The places a principle may apply to: anywhere, or a channel the person is in. */
export const placeChoices = (
  channels: ReadonlyArray<AsRead.Channel>,
  chosen: string | null,
): ReadonlyArray<PlaceChoice> => {
  const slugs = [
    ...new Set([
      ...channels.filter((channel) => channel.joined).map((channel) => channel.slug),
      ...(chosen === null ? [] : [chosen]),
    ]),
  ]
  return [
    { value: '', label: strings.teach.placeAnywhere, selected: chosen === null },
    ...slugs.map((slug) => ({ value: slug, label: placeName(slug), selected: slug === chosen })),
  ]
}

/** The warnings for what is typed in the add row of the principle list, as a rule or as an answer. */
export const addRowWarnings = (
  values: Readonly<Record<string, string>>,
  kind: PrincipleKind = 'rule',
): ReadonlyArray<string> =>
  adviceAsTyped({ kind, topic: values.topic ?? '', rule: values.rule ?? '' }).map(
    (advice) => strings.teach.advice[advice],
  )

/** The add row's choice between a rule and an answer, and what its text field is called for each. */
export const addRowKinds = (chosen: PrincipleKind): AddRowKinds => ({
  label: strings.teach.kindLabel,
  choices: (['rule', 'answer'] as const).map((kind) => ({
    kind,
    label: strings.teach.kindBadge[kind],
    checked: kind === chosen,
  })),
  textLabel: chosen === 'answer' ? strings.teach.answer : strings.teach.rule,
  maxLength: chosen === 'answer' ? ANSWER_TEXT_MAX : PRINCIPLE_TEXT_MAX,
})

/** The order after moving one principle to a new position, clamped to the list. */
export const reordered = (ids: ReadonlyArray<string>, id: string, to: number): string[] => {
  const order = ids.filter((each) => each !== id)
  order.splice(Math.max(0, Math.min(order.length, to)), 0, id)
  return order
}

/** The guided form as typed: what its labels say, what it warns about, and whether it may be saved. */
export const principleFormModel = (form: PrincipleFormState): PrincipleFormModel => {
  const answering = form.kind === 'answer'
  const host = form.source.trim() === '' ? null : sourceHost(form.source.trim())
  const confirming = needsConfirmation(form.offer, form.rule)
  return {
    ruleLabel: answering ? strings.teach.answer : strings.teach.rule,
    ruleHint: answering ? strings.teach.answerHint({ max: ANSWER_TEXT_MAX }) : strings.teach.ruleHint,
    ruleMaxLength: answering ? ANSWER_TEXT_MAX : PRINCIPLE_TEXT_MAX,
    ruleRequired: !answering,
    host: host === null ? '' : strings.teach.sourceHost({ host }),
    advice: adviceAsTyped({ kind: form.kind, topic: form.topic, rule: form.rule }).map((kind) => ({
      kind,
      className: `advice is-${kind.replace('_', '-')}`,
      text: strings.teach.advice[kind],
      offersAnswer: kind === 'stored_answer',
    })),
    showsPublic: form.isPublic,
    confirming,
    saveDisabled: confirming && !form.confirmed,
  }
}

/** What saving the guided form sends, or the reason it cannot be saved yet. */
export const principleToSave = (
  form: PrincipleFormState,
  editing: AsRead.Principle | null,
): { readonly problem: string } | { readonly save: PrincipleSave } => {
  const source = form.source.trim() === '' ? null : form.source.trim()
  const shared = form.isPublic && form.publicText.trim() !== '' ? form.publicText.trim() : null
  const item = { kind: form.kind, topic: form.topic, rule: form.rule, source }
  const problem = problemText(
    principleProblem(item) ??
      (shared === null
        ? null
        : publicTextProblem(shared, { ...item, place: editing?.place ?? (form.place || null) })),
  )
  if (problem !== null) return { problem }
  const common = {
    kind: form.kind,
    topic: form.topic.trim(),
    rule: form.rule.trim(),
    source,
    publicText: shared,
  }
  if (editing !== null) return { save: { kind: 'change', id: editing.id, change: common } }
  return {
    save: {
      kind: 'create',
      input: {
        ...common,
        place: form.place === '' ? null : form.place,
        ...(form.offer !== null && { offerId: form.offer.id, confirmed: form.confirmed }),
      },
    },
  }
}

/**
 * The form's starting values: the principle being edited, else the offer's suggestion, else what the
 * place of a miss gave it (a title and a channel), else empty.
 */
export const principleFormStart = (
  offer: AsRead.PrincipleOffer | null,
  editing: AsRead.Principle | null,
  showingPublic: boolean,
  seed: TeachSeed | null = null,
): PrincipleFormState => ({
  kind: editing?.kind === 'answer' ? 'answer' : 'rule',
  topic: editing?.topic ?? seed?.topic ?? '',
  rule: editing?.rule ?? (offer?.suggestion == null ? '' : suggestionText(offer.suggestion)),
  source: editing?.source ?? '',
  place: offer?.place ?? editing?.place ?? seed?.place ?? '',
  isPublic: showingPublic || (editing?.publicText ?? null) !== null,
  publicText: editing?.publicText ?? '',
  confirmed: false,
  offer,
})

/**
 * What a miss gives the guided form: a title from the first line of the note it was about, cut to a
 * few words and without the characters a title may not hold, and the channel it happened in.
 */
export const teachSeedOf = (text: string, place: string | null): TeachSeed => {
  const line = (text.split('\n').find((each) => each.trim() !== '') ?? '')
    .replace(/[;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?？.!。]+$/, '')
  const words = line.split(' ')
  let topic = ''
  for (const word of words) {
    const longer = topic === '' ? word : `${topic} ${word}`
    if (longer.length > SEED_TOPIC_MAX) break
    topic = longer
  }
  return { topic: topic === '' ? line.slice(0, SEED_TOPIC_MAX) : topic, place }
}

export interface TeachSeed {
  readonly topic: string
  readonly place: string | null
}

export type TaughtModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly text: string }
  | {
      readonly kind: 'taught'
      readonly intro: string
      readonly limit: string
      readonly chances: ReadonlyArray<ChanceModel>
      readonly empty: { readonly title: string; readonly hint: string } | null
      readonly principles: ReadonlyArray<PrincipleRow>
      readonly milestones: { readonly title: string; readonly items: ReadonlyArray<string> } | null
      readonly footnotes: ReadonlyArray<string>
    }

export interface AddRowKinds {
  readonly label: string
  readonly choices: ReadonlyArray<{
    readonly kind: 'rule' | 'answer'
    readonly label: string
    readonly checked: boolean
  }>
  readonly textLabel: string
  readonly maxLength: number
}

export interface ChanceModel {
  readonly offer: AsRead.PrincipleOffer
  readonly text: string
  /** The same chance as one line in the conversation it came from. */
  readonly here: { readonly text: string; readonly teach: string }
}

export interface AppliedMarker {
  readonly text: string
  readonly principleId: string | null
  readonly noteId: NoteId
}

export interface PlaceChoice {
  readonly value: string
  readonly label: string
  readonly selected: boolean
}

export interface PrincipleRow {
  readonly principle: AsRead.Principle
  readonly fields: ReadonlyArray<{
    readonly name: 'topic' | 'rule'
    readonly label: string
    readonly value: string
    readonly maxLength: number
    readonly wide?: boolean
  }>
  readonly details: ReadonlyArray<string>
  readonly kindBadge: string
  readonly problems: ReadonlyArray<string>
  readonly publicSwitch: { readonly isPublic: boolean; readonly label: string; readonly text: string }
}

export interface PrincipleFormState {
  readonly kind: PrincipleKind
  readonly topic: string
  readonly rule: string
  readonly source: string
  readonly place: string
  readonly isPublic: boolean
  readonly publicText: string
  readonly confirmed: boolean
  readonly offer: AsRead.PrincipleOffer | null
}

export interface PrincipleFormModel {
  readonly ruleLabel: string
  readonly ruleHint: string
  readonly ruleMaxLength: number
  readonly ruleRequired: boolean
  readonly host: string
  readonly advice: ReadonlyArray<{
    readonly kind: string
    readonly className: string
    readonly text: string
    readonly offersAnswer: boolean
  }>
  readonly showsPublic: boolean
  readonly confirming: boolean
  readonly saveDisabled: boolean
}

export type PrincipleSave =
  | {
      readonly kind: 'change'
      readonly id: string
      readonly change: {
        readonly kind: PrincipleKind
        readonly topic: string
        readonly rule: string
        readonly source: string | null
        readonly publicText: string | null
      }
    }
  | {
      readonly kind: 'create'
      readonly input: {
        readonly kind: PrincipleKind
        readonly topic: string
        readonly rule: string
        readonly source: string | null
        readonly publicText: string | null
        readonly place: string | null
        readonly offerId?: string
        readonly confirmed?: boolean
      }
    }

const chanceModel = (offer: AsRead.PrincipleOffer): ChanceModel => ({
  offer,
  text: (offer.kind === 'edit' ? strings.teach.chanceEdit : strings.teach.chanceDiscard)({
    place: placeName(offer.place),
  }),
  here:
    offer.kind === 'edit'
      ? { text: strings.teach.chanceHereEdit, teach: strings.teach.teachFromEdit }
      : { text: strings.teach.chanceHereDiscard, teach: strings.teach.teachFromDiscard },
})

/** A channel agent's principle as its managers edit it: the same row, with no place and no public sentence. */
export const channelPrincipleRow = (principle: AsRead.Principle): ChannelPrincipleRow => {
  const row = principleRow(principle)
  return {
    principle,
    fields: row.fields,
    kindBadge: row.kindBadge,
    problems: row.problems,
    details: principleDetails(principle, 'channel'),
  }
}

export type ChannelPrincipleRow = Omit<PrincipleRow, 'publicSwitch'>

const SEED_TOPIC_MAX = 60

const principleRow = (principle: AsRead.Principle): PrincipleRow => {
  const isPublic = principle.publicText !== null
  return {
    principle,
    fields: [
      { name: 'topic', label: strings.teach.topic, value: principle.topic, maxLength: PRINCIPLE_TOPIC_MAX },
      {
        name: 'rule',
        label: principle.kind === 'answer' ? strings.teach.answer : strings.teach.rule,
        value: principle.rule,
        maxLength: principle.kind === 'answer' ? ANSWER_TEXT_MAX : PRINCIPLE_TEXT_MAX,
        wide: true,
      },
    ],
    kindBadge: strings.teach.kindBadge[principle.kind],
    details: principleDetails(principle, 'person'),
    problems: principleAdvice(principle)
      .filter((kind) => kind === 'forbidden')
      .map((kind) => strings.teach.advice[kind]),
    publicSwitch: {
      isPublic,
      label: (isPublic ? strings.teach.makePrivate : strings.teach.makePublic)({ name: principle.topic }),
      text: isPublic ? strings.teach.isPublic : strings.teach.isPrivate,
    },
  }
}

/**
 * The quiet second line of a principle: where it applies, where it came from, and how it held up. A
 * channel agent's principles apply wherever it answers, so they name no place.
 */
const principleDetails = (principle: AsRead.Principle, owner: 'person' | 'channel'): string[] => {
  const counts = principle.counts === null ? null : countsShown(principle.counts)
  const host = principle.source === null ? null : sourceHost(principle.source)
  return [
    ...(owner === 'channel'
      ? [strings.channelTeach.origin[principle.origin]]
      : [
          principle.place === null ? strings.teach.anywhere : placeName(principle.place),
          strings.teach.origin[principle.origin],
        ]),
    ...(host === null ? [] : [strings.teach.sourceHost({ host })]),
    ...(counts === null
      ? []
      : [
          counts.applied === 0
            ? strings.teach.notApplied
            : strings.teach.appliedCounts({
                count: counts.applied,
                asWritten: counts.sentAsWritten,
                edited: counts.edited,
                discarded: counts.discarded,
              }),
          ...(counts.sentAsWrittenShare === null
            ? []
            : [strings.teach.share({ share: percentOf(counts.sentAsWrittenShare) })]),
          ...(counts.missed > 0 ? [strings.teach.missed({ count: counts.missed })] : []),
        ]),
  ]
}

/** The advice on a form being typed: nothing reads as vague before the rule has any words. */
const adviceAsTyped = (draft: Parameters<typeof principleAdvice>[0]): ReturnType<typeof principleAdvice> =>
  principleAdvice(draft).filter((kind) => kind !== 'vague' || draft.rule.trim() !== '')

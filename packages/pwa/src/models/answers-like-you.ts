import type { AsRead, PlaceName, RoutePoint } from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { percentOf, strings } from '../strings.ts'
import { decidedOf, periodOf, shareOf } from '../trust.ts'
import { placeName } from './places.ts'
import type { TeachSeed } from './teaching.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * "Where it answers like you": each place the agent drafts on a four-step track from only drafts to
 * answers like the person, with one sentence on where it stands and the next thing to do there. The
 * last step is the 30-day verdict, so it can be lost; when it is, the sentence calls it a chance to
 * teach. Without teaching, each place shows its count and sentence only.
 */
export const answersLikeYouModel = (
  report: AsRead.AgentReport | null,
  taught: AsRead.MyPrinciples | null,
  teaching: boolean,
): AnswersLikeYou | null => {
  if (report === null) return null
  if (teaching && taught === null) return null
  const routes = teaching && taught !== null ? taught.routes : null
  const period = periodOf(report, TRACK_DAYS)
  const keys = new Set<PlaceName>([
    ...period.current.places.map((place) => place.place),
    ...(routes ?? []).map((route) => route.place),
  ])
  if (keys.size === 0) return null
  const rows = [...keys]
    .map((place) =>
      rowOf(
        {
          place,
          now: period.current.places.find((each) => each.place === place) ?? null,
          before: period.previous.places.find((each) => each.place === place) ?? null,
          route: routes?.find((each) => each.place === place) ?? null,
          tracked: routes !== null,
        },
        report,
      ),
    )
    .sort(byDrafts)
  return {
    title: strings.answersLikeYou.title,
    intro: strings.answersLikeYou.intro,
    rows: rows.map(({ drafted: _, ...row }) => row),
    steps:
      routes === null
        ? null
        : {
            title: strings.answersLikeYou.stepsTitle,
            items: STEPS.map((step) => stepWords(step, report.minimumDecided)),
          },
    footnote: strings.answersLikeYou.footnote,
  }
}

export type Step = 1 | 2 | 3 | 4

export interface AnswersLikeYou {
  readonly title: string
  readonly intro: string
  readonly rows: ReadonlyArray<PlaceRow>
  /** What each step means and takes, written out for anyone who cannot hover; none without teaching. */
  readonly steps: { readonly title: string; readonly items: ReadonlyArray<StepWords> } | null
  readonly footnote: string
}

export interface PlaceRow {
  readonly key: string
  readonly name: string
  readonly count: string
  /** The track, the current step marked; null without teaching. */
  readonly track: Track | null
  readonly sentence: string
  /** The last step was reached in the 30 days before and lost since. */
  readonly slipped: boolean
  readonly action: Action | null
}

export interface Track {
  readonly label: string
  readonly step: Step
  /** The current step in words, shown where the step names do not fit. */
  readonly now: string
  readonly steps: ReadonlyArray<
    StepWords & { readonly id: string; readonly reached: boolean; readonly current: boolean }
  >
}

export interface StepWords {
  readonly name: string
  readonly meaning: string
  readonly toReach: string
  readonly last: boolean
}

export type Action =
  | { readonly kind: 'chances'; readonly label: string; readonly href: string }
  | { readonly kind: 'teach'; readonly label: string; readonly seed: TeachSeed }
  | { readonly kind: 'skipped'; readonly label: string; readonly notes: ReadonlyArray<SkippedNote> }

export interface SkippedNote {
  readonly key: string
  readonly time: TimeShown
  readonly href: string
  readonly open: string
}

const TRACK_DAYS = 30
const DAY_MS = 24 * 60 * 60_000

type StepName = keyof typeof strings.answersLikeYou.steps

const STEPS: ReadonlyArray<StepName> = ['drafting', 'taught', 'holding', 'likeYou']

interface PlaceFacts {
  readonly place: PlaceName
  readonly now: PlaceTrust | null
  readonly before: PlaceTrust | null
  readonly route: RoutePoint | null
  readonly tracked: boolean
}

const rowOf = (facts: PlaceFacts, report: AsRead.AgentReport): PlaceRow & { readonly drafted: number } => {
  const { place, now, before, route } = facts
  const name = placeName(place)
  const decided = now === null ? 0 : decidedOf(now)
  const drafted = Math.max(now?.written ?? 0, route?.drafted ?? 0)
  const step = stepOf(facts.tracked ? route : null, now?.verdict ?? null)
  const slipped = step < 4 && before?.verdict === 'usually_as_written' && decided >= report.minimumDecided
  const key = place ?? 'direct'
  return {
    key,
    name,
    drafted,
    count:
      decided > 0
        ? strings.answersLikeYou.decided({
            asWritten: now!.sentAsWritten,
            decided,
            share: percentOf(shareOf(now!.sentAsWritten, decided)!),
          })
        : drafted > 0
          ? strings.answersLikeYou.undecided({ count: drafted })
          : strings.answersLikeYou.noDrafts,
    track: facts.tracked ? trackOf(key, name, step, report.minimumDecided) : null,
    sentence: sentenceOf(
      facts.tracked ? step : Math.max(step, 3),
      slipped,
      now,
      decided,
      report.minimumDecided,
    ),
    slipped,
    action: facts.tracked ? actionOf(place, name, step, route, report) : null,
  }
}

const trackOf = (key: string, name: string, step: Step, minimum: number): Track => {
  const words = STEPS.map((each) => stepWords(each, minimum))
  return {
    label: strings.answersLikeYou.trackLabel({ place: name }),
    step,
    now: strings.answersLikeYou.stepOf({ step, name: words[step - 1]!.name }),
    steps: words.map((each, index) => ({
      ...each,
      id: `step-${key}-${index + 1}`,
      reached: index < step,
      current: index === step - 1,
    })),
  }
}

const stepWords = (step: StepName, minimum: number): StepWords => ({
  name: strings.answersLikeYou.steps[step],
  meaning: strings.answersLikeYou.meaning[step],
  toReach:
    step === 'holding'
      ? strings.answersLikeYou.toReach.holding({ minimum })
      : strings.answersLikeYou.toReach[step],
  last: step === 'likeYou',
})

const sentenceOf = (
  step: number,
  slipped: boolean,
  now: PlaceTrust | null,
  decided: number,
  minimum: number,
): string => {
  const next = strings.answersLikeYou.next
  if (step === 4) return next.likeYou
  if (step === 1) return next.drafting
  if (step === 2) return next.taught
  if (slipped) return next.slipped
  if (decided < minimum) return next.tooFew({ count: decided, minimum })
  return next.holding({ now: Math.floor((now!.sentAsWritten / decided) * 10) })
}

/** The next thing to do there: teach from its chances, teach a first principle, review skipped notes, or teach more. */
const actionOf = (
  place: PlaceName,
  name: string,
  step: Step,
  route: RoutePoint | null,
  report: AsRead.AgentReport,
): Action => {
  const words = strings.answersLikeYou
  const chances = route?.chances ?? 0
  if (chances > 0)
    return {
      kind: 'chances',
      label: words.teachFromChances({ count: chances }),
      href: hrefFor({ name: 'agent', section: 'teaching' }),
    }
  const seed = { topic: '', place }
  if (step === 1)
    return {
      kind: 'teach',
      label: place === null ? words.teachAnywhere : words.teachFirst({ place: name }),
      seed,
    }
  const skipped = skippedNotes(place, report)
  if (skipped.length > 0)
    return { kind: 'skipped', label: words.reviewSkipped({ count: skipped.length }), notes: skipped }
  return {
    kind: 'teach',
    label: place === null ? words.teachAnywhere : words.teachMore({ place: name }),
    seed,
  }
}

const skippedNotes = (place: PlaceName, report: AsRead.AgentReport): SkippedNote[] =>
  (report.misses ?? [])
    .filter(
      (miss) =>
        miss.outcome === 'skipped' &&
        miss.place === place &&
        miss.at > report.generatedAt - TRACK_DAYS * DAY_MS,
    )
    .map((miss) => ({
      key: miss.noteId,
      time: timeShown(miss.at, report.generatedAt),
      href: hrefFor({ name: 'conversation', id: miss.conversationId, draft: null, note: miss.noteId }),
      open: strings.teach.openConversation,
    }))

const byDrafts = (
  a: { readonly drafted: number; readonly key: string },
  b: { readonly drafted: number; readonly key: string },
): number => b.drafted - a.drafted || sortKey(a.key).localeCompare(sortKey(b.key))

const sortKey = (key: string): string => (key === 'direct' ? '￿' : key)

/** Where a place stands: 1 only drafts, 2 taught, 3 principles hold, 4 answers like the person. */
const stepOf = (route: RoutePoint | null, verdict: PlaceTrust['verdict'] | null): Step => {
  if (verdict === 'usually_as_written') return 4
  if (route === null || route.principles === 0) return 1
  return route.heldUp === 0 ? 2 : 3
}

type PlaceTrust = AsRead.AgentFigures['places'][number]

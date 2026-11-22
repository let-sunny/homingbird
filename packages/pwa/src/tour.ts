export type TourStepId = 'notes' | 'approval' | 'channels' | 'activity' | 'profile' | 'connect'

export const TOUR_STEPS: ReadonlyArray<TourStepId> = [
  'notes',
  'approval',
  'channels',
  'activity',
  'profile',
  'connect',
]

/**
 * The controls a step points at, the first one shown: a waiting draft's card, else the list's mark of
 * a conversation where one waits, as on a phone's list, else the bell that lists drafts.
 */
export const tourTargets = (id: TourStepId): ReadonlyArray<string> =>
  id === 'approval' ? ['approval', 'waiting-draft', 'activity'] : [id]

export interface TourStorage {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
  readonly removeItem: (key: string) => void
}

export const hasSeenTour = (storage: () => TourStorage): boolean => {
  try {
    return storage().getItem(TOUR_KEY) === SEEN
  } catch {
    return false
  }
}

export const rememberTourSeen = (storage: () => TourStorage): void => {
  try {
    storage().setItem(TOUR_KEY, SEEN)
  } catch {
    return
  }
}

export const forgetTourSeen = (storage: () => TourStorage): void => {
  try {
    storage().removeItem(TOUR_KEY)
  } catch {
    return
  }
}

/**
 * A first visit gets the tour on any page it can explain, a deep link to a conversation or a tab
 * included, so a reload in the middle starts it again; never over a sign-in, a consent, an invite,
 * the character editor or administration, which a person opens to finish one thing. While the first
 * steps are shown it waits: they are the better start, and they offer the tour themselves.
 */
export const mayStartTour = (
  routeName: string,
  seen: boolean,
  running: boolean,
  firstStepsShown: boolean,
): boolean => TOUR_ROUTES.has(routeName) && !seen && !running && !firstStepsShown

export const stepAfter = (step: number, direction: 1 | -1): number | null => {
  const next = step + direction
  return next < 0 ? 0 : next >= TOUR_STEPS.length ? null : next
}

const TOUR_ROUTES: ReadonlySet<string> = new Set([
  'home',
  'conversation',
  'people',
  'channels',
  'channel',
  'debates',
  'agent',
])

const TOUR_KEY = 'homingbird.tour'
const SEEN = 'seen'

export type TourStepId = 'notes' | 'connect' | 'channels' | 'activity' | 'profile'

export const TOUR_STEPS: ReadonlyArray<TourStepId> = ['notes', 'connect', 'channels', 'activity', 'profile']

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

export const mayStartTour = (routeName: string, seen: boolean, running: boolean): boolean =>
  routeName === 'home' && !seen && !running

export const stepAfter = (step: number, direction: 1 | -1): number | null => {
  const next = step + direction
  return next < 0 ? 0 : next >= TOUR_STEPS.length ? null : next
}

const TOUR_KEY = 'homingbird.tour'
const SEEN = 'seen'

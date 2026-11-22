import { describe, expect, it } from 'vitest'
import {
  TOUR_STEPS,
  type TourStorage,
  forgetTourSeen,
  hasSeenTour,
  mayStartTour,
  rememberTourSeen,
  stepAfter,
  tourTargets,
} from '../src/tour.ts'

const memory = (): TourStorage => {
  const kept = new Map<string, string>()
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
    removeItem: (key) => void kept.delete(key),
  }
}

const broken = (): TourStorage => {
  throw new Error('storage is blocked')
}

describe('the tour', () => {
  it('walks six steps: notes, the approval card, channels, the activity bell, the profile, connecting an agent', () => {
    expect(TOUR_STEPS).toEqual(['notes', 'approval', 'channels', 'activity', 'profile', 'connect'])
  })

  it('points the approval step at a waiting draft, else at the bell that lists drafts', () => {
    expect(tourTargets('approval')).toEqual(['approval', 'activity'])
    expect(tourTargets('notes')).toEqual(['notes'])
  })

  it('is shown once, then remembered on this device, and forgotten when asked again', () => {
    const storage = memory()
    expect(hasSeenTour(() => storage)).toBe(false)
    rememberTourSeen(() => storage)
    expect(hasSeenTour(() => storage)).toBe(true)
    forgetTourSeen(() => storage)
    expect(hasSeenTour(() => storage)).toBe(false)
  })

  it('still shows, and breaks nothing, when storage is unavailable', () => {
    expect(hasSeenTour(broken)).toBe(false)
    expect(() => rememberTourSeen(broken)).not.toThrow()
    expect(() => forgetTourSeen(broken)).not.toThrow()
  })

  it('starts on a first visit to a page it explains, never over a task the person came to finish, and never twice', () => {
    for (const route of ['home', 'conversation', 'people', 'channels', 'channel', 'debates', 'agent'])
      expect(mayStartTour(route, false, false)).toBe(true)
    for (const route of ['device', 'character', 'consent', 'invite', 'admin', 'signed-out', 'unknown'])
      expect(mayStartTour(route, false, false)).toBe(false)
    expect(mayStartTour('home', true, false)).toBe(false)
    expect(mayStartTour('home', false, true)).toBe(false)
  })

  it('steps forward and back, stays on the first step, and ends after the last', () => {
    expect(stepAfter(0, 1)).toBe(1)
    expect(stepAfter(0, -1)).toBe(0)
    expect(stepAfter(2, -1)).toBe(1)
    expect(stepAfter(TOUR_STEPS.length - 1, 1)).toBeNull()
  })
})

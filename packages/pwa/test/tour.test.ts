import { describe, expect, it } from 'vitest'
import {
  TOUR_STEPS,
  type TourStorage,
  forgetTourSeen,
  hasSeenTour,
  mayStartTour,
  rememberTourSeen,
  stepAfter,
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
  it('walks four steps: notes, connecting an agent, channels, the profile', () => {
    expect(TOUR_STEPS).toEqual(['notes', 'connect', 'channels', 'profile'])
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

  it('starts only on the home view, never over a deep link, and never twice', () => {
    expect(mayStartTour('home', false, false)).toBe(true)
    for (const route of ['conversation', 'device', 'character', 'channel'])
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

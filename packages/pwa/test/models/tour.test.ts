import { describe, expect, it } from 'vitest'
import { tourStepModel } from '../../src/models/tour.ts'
import { strings } from '../../src/strings.ts'

describe('tourStepModel', () => {
  it('starts with the notes, beside the list, and offers no way back', () => {
    const model = tourStepModel(0, true)
    expect(model).toMatchObject({
      id: 'notes',
      placement: 'beside',
      progress: strings.tour.progress({ step: 1, total: 5 }),
      title: strings.tour.notesTitle,
      lookFor: null,
      connect: null,
      back: null,
      next: strings.tour.next,
    })
  })

  it('offers to connect an agent on that step and names the place when the callout cannot point at it', () => {
    const model = tourStepModel(1, false)
    expect(model.connect).toEqual({ href: '#/agent/connection', label: strings.tour.connectAction })
    expect(model.lookFor).toBe(strings.tour.lookFor({ place: strings.navMyAgent }))
    expect(model.back).toBe(strings.tour.back)
  })

  it('names every step’s place and finishes on the last', () => {
    expect(tourStepModel(2, false).lookFor).toBe(strings.tour.lookFor({ place: strings.channels }))
    expect(tourStepModel(3, false)).toMatchObject({
      id: 'activity',
      placement: 'below',
      title: strings.tour.activityTitle,
      lookFor: strings.tour.lookFor({ place: strings.tour.activityPlace }),
    })
    const last = tourStepModel(4, false)
    expect(last.lookFor).toBe(strings.tour.lookFor({ place: strings.tour.menuPlace }))
    expect(last.next).toBe(strings.tour.done)
  })
})

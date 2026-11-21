import { describe, expect, it } from 'vitest'
import { tourStepModel } from '../../src/models/tour.ts'
import { strings } from '../../src/strings.ts'

describe('tourStepModel', () => {
  it('starts with the notes, beside the list, and offers no way back', () => {
    const model = tourStepModel(0, true)
    expect(model).toMatchObject({
      id: 'notes',
      placement: 'beside',
      progress: strings.tour.progress({ step: 1, total: 6 }),
      title: strings.tour.notesTitle,
      lookFor: null,
      connect: null,
      back: null,
      next: strings.tour.next,
    })
  })

  it('shows the approval card second, and names the bell when it cannot point at a draft', () => {
    const model = tourStepModel(1, false)
    expect(model).toMatchObject({
      id: 'approval',
      title: strings.tour.approvalTitle,
      body: strings.tour.approvalBody,
      lookFor: strings.tour.lookFor({ place: strings.tour.activityPlace }),
      connect: null,
      back: strings.tour.back,
    })
  })

  it('names every step’s place and finishes by offering to connect an agent', () => {
    expect(tourStepModel(2, false).lookFor).toBe(strings.tour.lookFor({ place: strings.channels }))
    expect(tourStepModel(3, false)).toMatchObject({
      id: 'activity',
      placement: 'below',
      title: strings.tour.activityTitle,
      lookFor: strings.tour.lookFor({ place: strings.tour.activityPlace }),
    })
    expect(tourStepModel(4, false).lookFor).toBe(strings.tour.lookFor({ place: strings.tour.menuPlace }))
    const last = tourStepModel(5, false)
    expect(last.connect).toEqual({ href: '#/agent/connection', label: strings.tour.connectAction })
    expect(last.lookFor).toBe(strings.tour.lookFor({ place: strings.navMyAgent }))
    expect(last.next).toBe(strings.tour.done)
  })
})

import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { TOUR_STEPS, type TourStepId } from '../tour.ts'

/** One step of the tour: where it is, what it says, and the way on. */
export const tourStepModel = (step: number, targetShown: boolean): TourStepModel => {
  const id = TOUR_STEPS[step]!
  const text = STEP_TEXT[id]()
  return {
    id,
    placement: PLACEMENT[id],
    progress: strings.tour.progress({ step: step + 1, total: TOUR_STEPS.length }),
    title: text.title,
    body: text.body,
    lookFor: targetShown ? null : strings.tour.lookFor({ place: text.place }),
    connect:
      id === 'connect'
        ? { href: hrefFor({ name: 'agent', section: 'connection' }), label: strings.tour.connectAction }
        : null,
    back: step > 0 ? strings.tour.back : null,
    next: step === TOUR_STEPS.length - 1 ? strings.tour.done : strings.tour.next,
  }
}

export interface TourStepModel {
  readonly id: TourStepId
  readonly placement: 'beside' | 'below'
  readonly progress: string
  readonly title: string
  readonly body: string
  /** Without anchor positioning the callout cannot sit beside its control, so it names it in words. */
  readonly lookFor: string | null
  readonly connect: { readonly href: string; readonly label: string } | null
  readonly back: string | null
  readonly next: string
}

const PLACEMENT: Readonly<Record<TourStepId, 'beside' | 'below'>> = {
  notes: 'beside',
  connect: 'below',
  channels: 'below',
  profile: 'below',
}

const STEP_TEXT: Readonly<
  Record<TourStepId, () => { readonly title: string; readonly body: string; readonly place: string }>
> = {
  notes: () => ({
    title: strings.tour.notesTitle,
    body: strings.tour.notesBody,
    place: strings.conversations,
  }),
  connect: () => ({
    title: strings.tour.connectTitle,
    body: strings.tour.connectBody,
    place: strings.navMyAgent,
  }),
  channels: () => ({
    title: strings.tour.channelsTitle,
    body: strings.tour.channelsBody,
    place: strings.channels,
  }),
  profile: () => ({
    title: strings.tour.profileTitle,
    body: strings.tour.profileBody,
    place: strings.tour.menuPlace,
  }),
}

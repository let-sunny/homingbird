import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, type ReadableSignal, isSameData, onAnyChange, signal } from '@homingbird/ui'
import { activityModel } from '../models/activity.ts'
import { NOTHING_WAITS, type Waiting, outsideTabModel, waitingOf } from '../models/waiting.ts'
import { activityInputOf, activitySources } from './activity.ts'
import type { ViewContext } from './context.ts'

/**
 * What waits for the person, kept current from the same state the activity panel reads, and shown
 * outside the tab while they are signed in: in the tab's title and the app badge. Signing out leaves
 * the plain name and no badge.
 */
export const watchWaiting = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
): ReadableSignal<Waiting> => {
  const { state } = context
  const waiting = signal<Waiting>(NOTHING_WAITS)
  const refresh = (): void => {
    const next = waitingOf(activityModel(activityInputOf(context, me)))
    if (!isSameData(next, waiting.get())) waiting.set(next)
  }
  const show = (): void => {
    const shown = outsideTabModel({
      name: state.branding.get().name,
      waiting: waiting.get(),
      conversations: state.conversations.get(),
    })
    context.page.showWaiting(shown.title, shown.badge)
  }
  refresh()
  show()
  life.add(onAnyChange(activitySources(context), refresh))
  life.add(onAnyChange([waiting, state.branding, state.conversations], show))
  life.add(() => context.page.showWaiting(state.branding.get().name, null))
  return waiting
}

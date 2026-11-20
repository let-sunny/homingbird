import { h } from '@homingbird/ui'
import type { MuteToggle } from '../models/mute-toggle.ts'
import type { ViewContext } from './context.ts'

/** The button that mutes a conversation or lifts its mute; it says the action it takes. */
export const muteButton = (context: ViewContext, model: MuteToggle): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: 'mute-toggle',
      'aria-label': model.label,
      title: model.hint,
      data: { muted: String(model.muted) },
      on: { click: () => context.actions.setMuted(model.conversationId, !model.muted) },
    },
    model.text,
  )

/** The word beside a muted conversation's name. */
export const mutedMark = (text: string): HTMLElement => h('span', { class: 'muted-mark' }, text)

import { h, svg } from '@homingbird/ui'
import type { MuteToggle } from '../models/mute-toggle.ts'
import type { ViewContext } from './context.ts'

/**
 * The button that mutes a conversation or lifts its mute: a bell, struck through while muted, named
 * for the action it takes.
 */
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
    bell(model.muted),
  )

/** The struck-through bell beside a muted conversation's name, with its word for screen readers. */
export const mutedMark = (text: string): HTMLElement =>
  h('span', { class: 'muted-mark', title: text }, bell(true), h('span', { class: 'visually-hidden' }, text))

const bell = (struck: boolean): SVGElement =>
  svg(
    'svg',
    { class: 'bell', viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' },
    svg('path', {
      d: 'M8 1.5a4.5 4.5 0 0 0-4.5 4.5v3L2 11.5h12L12.5 9V6A4.5 4.5 0 0 0 8 1.5ZM6.5 13a1.5 1.5 0 0 0 3 0',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linejoin': 'round',
    }),
    ...(struck
      ? [
          svg('path', {
            d: 'M2 2l12 12',
            stroke: 'currentColor',
            'stroke-width': 1.5,
            'stroke-linecap': 'round',
          }),
        ]
      : []),
  )

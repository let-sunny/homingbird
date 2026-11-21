import { h, svg } from '@homingbird/ui'
import type { MuteToggle } from '../models/mute-toggle.ts'
import type { ViewContext } from './context.ts'

/**
 * The button that mutes a conversation or lifts its mute: a ringing bell, struck through while muted,
 * named for the action it takes. It rings so that it does not read as a second activity bell.
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
    model.muted ? bellIcon(true) : ringingBellIcon(),
  )

/** The struck-through bell beside a muted conversation's name, with its word for screen readers. */
export const mutedMark = (text: string): HTMLElement =>
  h(
    'span',
    { class: 'muted-mark', title: text },
    bellIcon(true),
    h('span', { class: 'visually-hidden' }, text),
  )

/** A bell drawn in the text colour, struck through for a muted conversation. */
export const bellIcon = (struck: boolean): SVGElement =>
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

/** A bell with a sound line on either side: notifications for this conversation are on. */
const ringingBellIcon = (): SVGElement => {
  const icon = bellIcon(false)
  icon.setAttribute('viewBox', '-3 0 22 16')
  icon.setAttribute('width', '22')
  icon.classList.add('is-ringing')
  for (const d of ['M-1 4q-1.5 2.5 0 5', 'M17 4q1.5 2.5 0 5'])
    icon.append(
      svg('path', {
        d,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.5,
        'stroke-linecap': 'round',
      }),
    )
  return icon
}

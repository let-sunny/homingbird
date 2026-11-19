import { h } from '@homingbird/ui'

export type PipState =
  | 'idle'
  | 'offline'
  | 'connecting'
  | 'disconnected'
  | 'drafting'
  | 'awaiting-approval'
  | 'sending'
  | 'delivered'
  | 'read'
  | 'new-note'
  | 'failed'
  | 'waving'
  | 'blocked'
  | 'searching'
  | 'sign-in'
  | 'approved'
  | 'discarded'

export type PipScale = 2 | 3 | 4

export const pip = (state: PipState, scale: PipScale = 2, label?: string): HTMLElement =>
  h('span', {
    class: `pip is-${state} pip-x${scale}`,
    role: label === undefined ? 'presentation' : 'img',
    'aria-label': label,
    'aria-hidden': label === undefined && 'true',
  })

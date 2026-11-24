import { h } from '@homingbird/ui'
import type { StartModel } from '../models/start.ts'
import { button } from './parts.ts'
import { pip } from './pip.ts'

/** The page while the session is not known yet; `retry` starts the load again. */
export const startView = (model: StartModel, retry: () => void): HTMLElement =>
  model.kind === 'loading'
    ? h('p', { class: 'loading boot', role: 'status' }, model.text)
    : h(
        'main',
        { class: 'sign-in' },
        h(
          'div',
          { class: 'window sign-in-window' },
          h('div', { class: 'window-title' }, model.title),
          h(
            'div',
            { class: 'window-body' },
            pip(model.pip, 4),
            h('p', { class: 'tagline', role: 'status' }, model.text),
            button(model.retry, retry, { class: 'primary' }),
          ),
        ),
      )

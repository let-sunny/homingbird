import { h } from '@homingbird/ui'
import { signInHref } from '../routes.ts'
import { branding, serverInfo } from '../state.ts'
import { strings } from '../strings.ts'
import { wordmark } from './parts.ts'
import { pip } from './pip.ts'

export const signInView = (refusal: string | null): HTMLElement =>
  h(
    'main',
    { class: 'sign-in' },
    h(
      'div',
      { class: 'window sign-in-window' },
      h('div', { class: 'window-title' }, refusal === null ? strings.welcome : strings.signedOutTitle),
      h(
        'div',
        { class: 'window-body' },
        pip(refusal === null ? 'sign-in' : 'failed', 6),
        h('h1', { class: 'wordmark' }, wordmark(branding.get().name)),
        h('p', { class: 'tagline' }, strings.tagline),
        refusal !== null && h('p', { class: 'refusal', role: 'alert' }, refusal),
        h(
          'a',
          { class: 'button primary', href: signInHref(location.hash) },
          strings.signInWith({ provider: serverInfo.get()?.signInWith ?? '…' }),
        ),
      ),
    ),
  )

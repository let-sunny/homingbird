import { h } from '@homingbird/ui'
import { signInHref } from '../routes.ts'
import { branding, serverInfo } from '../state.ts'
import { strings } from '../strings.ts'

export const signInView = (refusal: string | null): HTMLElement =>
  h(
    'main',
    { class: 'sign-in' },
    h(
      'div',
      { class: 'window sign-in-window' },
      h('div', { class: 'window-title' }, branding.get().name),
      h(
        'div',
        { class: 'window-body' },
        h('img', { class: 'logo', src: branding.get().logo ?? '/icons/logo.svg', alt: '', width: '96', height: '96' }),
        h('h1', {}, branding.get().name),
        h('p', { class: 'tagline' }, strings.tagline),
        refusal !== null && h('p', { class: 'refusal', role: 'alert' }, refusal),
        h(
          'a',
          { class: 'button primary', href: signInHref(location.hash) },
          strings.signInWith(serverInfo.get()?.signInWith ?? '…'),
        ),
      ),
    ),
  )

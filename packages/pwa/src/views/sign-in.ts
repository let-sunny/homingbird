import { h } from '@homingbird/ui'
import { type SignInModel, signInModel } from '../models/sign-in.ts'
import type { ViewContext } from './context.ts'
import { renderTurningPip } from './turning-bird.ts'

export const signInView = (
  context: ViewContext,
  refusal: string | null,
  invite: string | null,
): HTMLElement =>
  renderSignIn(
    signInModel({
      refusal,
      invite,
      brandingName: context.state.branding.get().name,
      signInWith: context.state.serverInfo.get()?.signInWith ?? null,
      hash: context.page.hash(),
      origin: context.page.origin,
    }),
  )

const renderSignIn = (model: SignInModel): HTMLElement =>
  h(
    'main',
    { class: 'sign-in' },
    h(
      'div',
      { class: 'window sign-in-window' },
      h('div', { class: 'window-title' }, model.title),
      h(
        'div',
        { class: 'window-body' },
        renderTurningPip(2),
        h('h1', { class: 'wordmark' }, model.wordmark),
        h('p', { class: 'tagline' }, model.tagline),
        model.refusal !== null && h('p', { class: 'refusal', role: 'alert' }, model.refusal),
        model.signIn.kind === 'link'
          ? h('a', { class: 'button primary', href: model.signIn.href }, model.signIn.label)
          : h(
              'form',
              { method: 'post', action: model.signIn.action, class: 'invite-accept' },
              h('input', { type: 'hidden', name: 'code', value: model.signIn.code }),
              h('button', { type: 'submit', class: 'primary' }, model.signIn.label),
            ),
      ),
    ),
  )

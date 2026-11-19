import { h } from '@homingbird/ui'
import { type SignInModel, signInModel } from '../models/sign-in.ts'
import type { ViewContext } from './context.ts'
import { pip } from './pip.ts'

export const signInView = (context: ViewContext, refusal: string | null): HTMLElement =>
  renderSignIn(
    signInModel({
      refusal,
      brandingName: context.state.branding.get().name,
      signInWith: context.state.serverInfo.get()?.signInWith ?? null,
      hash: context.page.hash(),
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
        pip(model.pip, 4),
        h('h1', { class: 'wordmark' }, model.wordmark),
        h('p', { class: 'tagline' }, model.tagline),
        model.refusal !== null && h('p', { class: 'refusal', role: 'alert' }, model.refusal),
        h('a', { class: 'button primary', href: model.signIn.href }, model.signIn.label),
      ),
    ),
  )
